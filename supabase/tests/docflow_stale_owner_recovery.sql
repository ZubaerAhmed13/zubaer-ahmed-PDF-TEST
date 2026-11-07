-- Red before expiry integration: a dead lease must not strand an owner's slot.
begin;
select pg_advisory_xact_lock(642051830017::bigint);
do $test$
declare owner uuid:=gen_random_uuid(); j jsonb; fresh jsonb;
begin
  if exists(select 1 from public.docflow_jobs) then raise exception 'Probe requires empty docflow_jobs'; end if;
  insert into auth.users(id,email) values(owner,'docflow-stale-probe-'||owner||'@example.invalid');
  j:=public.docflow_job_action('create',jsonb_build_object('owner',owner,'idempotencyKey',gen_random_uuid(),'requestHash',repeat('a',64),'request','{"operation":"compress","files":[{"name":"source.pdf"}]}'::jsonb));
  perform public.docflow_job_action('start',jsonb_build_object('owner',owner,'job',j->>'id','claimHash',repeat('b',64)));
  perform public.docflow_job_action('claim',jsonb_build_object('job',j->>'id','claimHash',repeat('b',64)));
  update public.docflow_jobs set lease_until=now()-interval '1 second' where id=(j->>'id')::uuid;
  fresh:=public.docflow_job_action('create',jsonb_build_object('owner',owner,'idempotencyKey',gen_random_uuid(),'requestHash',repeat('c',64),'request','{"operation":"compress","files":[{"name":"retry.pdf"}]}'::jsonb));
  if fresh->>'state'<>'queued' or (select state from public.docflow_jobs where id=(j->>'id')::uuid)<>'expired' then raise exception 'Dead worker lease did not expire and release the owner slot'; end if;
end $test$;
rollback;
select jsonb_build_object('stale_owner_recovery','passed','persisted_jobs',(select count(*) from public.docflow_jobs),'persisted_probe_users',(select count(*) from auth.users where email like 'docflow-stale-probe-%@example.invalid')) as evidence;
