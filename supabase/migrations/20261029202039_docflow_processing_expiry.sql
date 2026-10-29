-- Expiry is control-plane maintenance, not physical Storage deletion.
-- Keep rows/started_at for rolling quotas; the Storage API purger follows separately.
create function public.docflow_expire_jobs(p_owner uuid default null,p_limit integer default 100,p_job uuid default null)
returns integer language plpgsql security invoker set search_path = '' as $$
declare expired_count integer;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid expiry batch size'; end if;
  perform pg_catalog.pg_advisory_xact_lock(642051830017::bigint);
  with due as (
    select id from public.docflow_jobs
    where state <> 'expired' and (p_owner is null or owner_id=p_owner) and (p_job is null or id=p_job)
      and (expires_at <= now() or (state in ('running','cancelling') and lease_until <= now()))
    order by case when state in ('running','cancelling') and expires_at>now() then 0 when state in ('running','cancelling') then 1 else 2 end,
      coalesce(lease_until,expires_at),id
    limit p_limit for update skip locked
  )
  update public.docflow_jobs j
  set state='expired',phase='done',output=null,output_path=null,details=null,request='{}'::jsonb,
    expires_at=least(j.expires_at,now()),
    error_code=case when j.state in ('running','cancelling') and j.lease_until <= now() then 'deadline' else 'job_expired' end
  from due where j.id=due.id;
  get diagnostics expired_count = row_count;
  return expired_count;
end $$;
revoke all on function public.docflow_expire_jobs(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.docflow_expire_jobs(uuid,integer,uuid) to service_role;

create or replace function public.docflow_job_action(p_action text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j public.docflow_jobs;
  c docflow_private.job_claims;
  owner uuid;
  job uuid;
  token text;
  ext text;
  result jsonb;
  out_meta jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(642051830017::bigint);
  if octet_length(p_payload::text) > 32768 then raise exception 'Payload too large'; end if;
  -- Owner-scoped maintenance prioritises dead workers before checking their slot.
  if p_action in ('create','start','cancel','read') then
    perform public.docflow_expire_jobs((p_payload->>'owner')::uuid,100,case when p_action='create' then null else (p_payload->>'job')::uuid end);
  end if;
  if p_action = 'create' then
    owner := (p_payload->>'owner')::uuid;
    select * into j from public.docflow_jobs where owner_id = owner and idempotency_key = (p_payload->>'idempotencyKey')::uuid;
    if found then
      if j.request_hash is distinct from (p_payload->>'requestHash') then raise exception 'Idempotency conflict'; end if;
      return to_jsonb(j);
    end if;
    if exists(select 1 from public.docflow_jobs where owner_id = owner and state in ('queued','running','cancelling') and expires_at > now()) then raise exception 'Owner active job limit reached'; end if;
    if (select count(*) from public.docflow_jobs where owner_id = owner and created_at > now()-interval '24 hours') >= 20
      or (select count(*) from public.docflow_jobs where created_at > now()-interval '24 hours') >= 100 then raise exception 'Job creation quota reached'; end if;
    ext := lower(split_part(p_payload#>>'{request,files,0,name}', '.', -1));
    if ext not in ('pdf','docx','pptx','xlsx') then raise exception 'Unsupported input extension'; end if;
    job := gen_random_uuid();
    insert into public.docflow_jobs(id,owner_id,idempotency_key,request,request_hash,operation,input_path)
      values(job,owner,(p_payload->>'idempotencyKey')::uuid,p_payload->'request',p_payload->>'requestHash',p_payload#>>'{request,operation}',owner::text||'/'||job::text||'/input/0.'||ext) returning * into j;
    insert into docflow_private.job_claims(job_id) values(j.id);
    return to_jsonb(j);
  end if;
  job := (p_payload->>'job')::uuid;
  select * into j from public.docflow_jobs where id=job for update;
  if not found then raise exception 'Job not found'; end if;
  select * into c from docflow_private.job_claims where job_id=job for update;
  if p_action in ('start','cancel','read') then
    if j.owner_id is distinct from (p_payload->>'owner')::uuid then raise exception 'Job not found'; end if;
  end if;
  if p_action = 'read' then return to_jsonb(j); end if;
  if p_action = 'start' then
    if j.expires_at <= now() then raise exception 'Job expired'; end if;
    if j.state <> 'queued' then return jsonb_build_object('dispatch',false,'job',to_jsonb(j)); end if;
    token := p_payload->>'claimHash';
    if token is null or token !~ '^[0-9a-f]{64}$' then raise exception 'Invalid claim'; end if;
    update public.docflow_jobs set phase='runnable' where id=job returning * into j;
    update docflow_private.job_claims set claim_hash=token,claim_until=now()+interval '60 seconds' where job_id=job;
    return jsonb_build_object('dispatch',true,'job',to_jsonb(j));
  elsif p_action = 'claim' then
    if c.claim_hash is null or c.claim_hash is distinct from (p_payload->>'claimHash') or c.claim_until <= now() or j.state <> 'queued' or j.phase <> 'runnable' or j.expires_at <= now() then raise exception 'Claim rejected'; end if;
    if (select count(*) from public.docflow_jobs where state in ('running','cancelling') and lease_until > now()) >= 2 then raise exception 'Global processing limit reached'; end if;
    if (select count(*) from public.docflow_jobs where started_at > now()-interval '24 hours') >= 10 then raise exception 'Daily processing quota reached'; end if;
    update public.docflow_jobs set state='running',phase='processing',attempt=attempt+1,started_at=now(),lease_until=now()+interval '210 seconds' where id=job returning * into j;
    update docflow_private.job_claims set claim_until=j.lease_until where job_id=job;
    return to_jsonb(j);
  elsif p_action = 'cancel' then
    if j.state = 'queued' then
      update public.docflow_jobs set state='cancelled',phase='done' where id=job returning * into j;
      update docflow_private.job_claims set claim_hash=null,claim_until=null where job_id=job;
      return jsonb_build_object('dispatch',false,'job',to_jsonb(j));
    end if;
    if j.state = 'running' then update public.docflow_jobs set state='cancelling' where id=job returning * into j; end if;
    if j.state <> 'cancelling' then return jsonb_build_object('dispatch',false,'job',to_jsonb(j)); end if;
    token := p_payload->>'cancelHash';
    if token is null or token !~ '^[0-9a-f]{64}$' then raise exception 'Invalid cancellation claim'; end if;
    update docflow_private.job_claims set cancel_hash=token,cancel_until=now()+interval '60 seconds' where job_id=job;
    return jsonb_build_object('dispatch',c.vm_name is not null,'job',to_jsonb(j));
  elsif p_action = 'cancel-claim' then
    if j.state <> 'cancelling' or c.cancel_hash is null or c.cancel_hash is distinct from (p_payload->>'cancelHash') or c.cancel_until <= now() then raise exception 'Cancellation claim rejected'; end if;
    return jsonb_build_object('vmName',c.vm_name,'attempt',j.attempt);
  elsif p_action = 'cancelled' then
    if j.state not in ('cancelling','cancelled') or c.cancel_hash is null or c.cancel_hash is distinct from (p_payload->>'cancelHash') or c.cancel_until <= now() then raise exception 'Cancellation claim rejected'; end if;
    if j.state = 'cancelled' then return to_jsonb(j); end if;
    update public.docflow_jobs set state='cancelled',phase='done' where id=job returning * into j;
    return to_jsonb(j);
  end if;
  -- The worker session is still the consumed, hashed claim and its exact attempt/lease.
  if c.claim_hash is null or c.claim_hash is distinct from (p_payload->>'claimHash') or c.claim_until <= now() or j.attempt is distinct from (p_payload->>'attempt')::integer then raise exception 'Worker lease rejected'; end if;
  if p_action = 'attach' then
    if j.state not in ('running','cancelling') or j.expires_at <= now() then raise exception 'Job no longer active'; end if;
    if (p_payload->>'vmName') is distinct from ('df-'||job::text||'-'||j.attempt::text) then raise exception 'Unexpected VM name'; end if;
    update docflow_private.job_claims set vm_name=p_payload->>'vmName' where job_id=job;
    return jsonb_build_object('cancel',j.state='cancelling');
  elsif p_action = 'finish' then
    if j.state = 'cancelling' then
      update public.docflow_jobs set state='cancelled',phase='done' where id=job returning * into j;
      return to_jsonb(j);
    end if;
    if j.state <> 'running' or j.lease_until <= now() or j.expires_at <= now() then raise exception 'Result publication rejected'; end if;
    if p_payload->>'outcome' = 'completed' then
      out_meta := p_payload->'output';
      if out_meta is null or jsonb_typeof(out_meta) <> 'object' or out_meta->>'name' is distinct from 'result.pdf' or out_meta->>'type' is distinct from 'application/pdf'
        or not (out_meta ?& array['size','pages','sha256']) or out_meta->>'sha256' is null
        or jsonb_typeof(out_meta->'size') is distinct from 'number' or jsonb_typeof(out_meta->'pages') is distinct from 'number'
        or (out_meta->>'size')::bigint not between 8 and 52428800
        or (out_meta->>'pages')::integer not between 1 and 100
        or out_meta->>'sha256' !~ '^[0-9a-f]{64}$' then raise exception 'Invalid verified output'; end if;
      update public.docflow_jobs set state='completed',phase='done',output=out_meta,details=p_payload->'details',output_path=owner_id::text||'/'||id::text||'/output/result.pdf',expires_at=now()+interval '30 minutes' where id=job returning * into j;
    else
      update public.docflow_jobs set state='failed',phase='done',error_code=case when p_payload->>'errorCode' in ('unsupported_input','engine_error','deadline','worker_error') then p_payload->>'errorCode' else 'worker_error' end where id=job returning * into j;
    end if;
    return to_jsonb(j);
  end if;
  raise exception 'Unknown job action';
end $$;
revoke all on function public.docflow_job_action(text,jsonb) from public, anon, authenticated;
grant execute on function public.docflow_job_action(text,jsonb) to service_role;

