-- Expiry must respect completion constraints and keep daily quota history.
begin;
select pg_advisory_xact_lock(642051830017::bigint);
do $test$
declare owner uuid:=gen_random_uuid(); j jsonb; again jsonb; key uuid:=gen_random_uuid(); n integer;
begin
  if exists(select 1 from public.docflow_jobs) then raise exception 'Probe requires empty docflow_jobs'; end if;
  if has_function_privilege('anon','public.docflow_expire_jobs(uuid,integer,uuid)','EXECUTE') or has_function_privilege('authenticated','public.docflow_expire_jobs(uuid,integer,uuid)','EXECUTE') or not has_function_privilege('service_role','public.docflow_expire_jobs(uuid,integer,uuid)','EXECUTE') then raise exception 'Expiry RPC privileges are wrong'; end if;
  insert into auth.users(id,email) values(owner,'docflow-expiry-probe-'||owner||'@example.invalid');
  j:=public.docflow_job_action('create',jsonb_build_object('owner',owner,'idempotencyKey',key,'requestHash',repeat('a',64),'request','{"operation":"compress","files":[{"name":"private-name.pdf"}]}'::jsonb));
  perform public.docflow_job_action('start',jsonb_build_object('owner',owner,'job',j->>'id','claimHash',repeat('b',64)));
  perform public.docflow_job_action('claim',jsonb_build_object('job',j->>'id','claimHash',repeat('b',64)));
  j:=public.docflow_job_action('finish',jsonb_build_object('job',j->>'id','claimHash',repeat('b',64),'attempt',1,'outcome','completed','output',jsonb_build_object('name','result.pdf','type','application/pdf','size',1000,'pages',1,'sha256',repeat('c',64))));
  update public.docflow_jobs set expires_at=now()-interval '1 second' where id=(j->>'id')::uuid;
  j:=public.docflow_job_action('read',jsonb_build_object('owner',owner,'job',j->>'id'));
  if j->>'state'<>'expired' or j->'output'<>'null'::jsonb or j->'output_path'<>'null'::jsonb or j->'request'<>'{}'::jsonb or j->'started_at'='null'::jsonb then raise exception 'Completed expiry lost constraints, metadata erasure or quota history'; end if;
  again:=public.docflow_job_action('create',jsonb_build_object('owner',owner,'idempotencyKey',key,'requestHash',repeat('a',64)));
  if again->>'id'<>j->>'id' or again->>'state'<>'expired' then raise exception 'Expired idempotency created a new job'; end if;
  for n in 1..9 loop
    j:=public.docflow_job_action('create',jsonb_build_object('owner',owner,'idempotencyKey',gen_random_uuid(),'requestHash',repeat('a',64),'request','{"operation":"compress","files":[{"name":"source.pdf"}]}'::jsonb));
    perform public.docflow_job_action('start',jsonb_build_object('owner',owner,'job',j->>'id','claimHash',repeat('d',64)));
    perform public.docflow_job_action('claim',jsonb_build_object('job',j->>'id','claimHash',repeat('d',64)));
    perform public.docflow_job_action('finish',jsonb_build_object('job',j->>'id','claimHash',repeat('d',64),'attempt',1,'outcome','failed','errorCode','engine_error'));
  end loop;
  j:=public.docflow_job_action('create',jsonb_build_object('owner',owner,'idempotencyKey',gen_random_uuid(),'requestHash',repeat('a',64),'request','{"operation":"compress","files":[{"name":"source.pdf"}]}'::jsonb));
  perform public.docflow_job_action('start',jsonb_build_object('owner',owner,'job',j->>'id','claimHash',repeat('e',64)));
  begin
    perform public.docflow_job_action('claim',jsonb_build_object('job',j->>'id','claimHash',repeat('e',64)));
    raise exception 'Expiry bypassed the daily-start quota';
  exception when others then if sqlerrm<>'Daily processing quota reached' then raise; end if; end;
end $test$;
rollback;
select jsonb_build_object('expiry_probes','passed','persisted_jobs',(select count(*) from public.docflow_jobs),'persisted_probe_users',(select count(*) from auth.users where email like 'docflow-expiry-probe-%@example.invalid')) as evidence;
