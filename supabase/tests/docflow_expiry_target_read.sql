-- An explicitly read overdue result must expire even beyond the bounded sweep.
begin;
select pg_advisory_xact_lock(642051830017::bigint);
do $test$
declare owner uuid:=gen_random_uuid(); target uuid; row_id uuid; j jsonb; n integer;
begin
  if exists(select 1 from public.docflow_jobs) then raise exception 'Probe requires empty docflow_jobs'; end if;
  insert into auth.users(id,email) values(owner,'docflow-target-probe-'||owner||'@example.invalid');
  for n in 1..101 loop
    row_id:=gen_random_uuid();target:=row_id;
    insert into public.docflow_jobs(id,owner_id,idempotency_key,request,request_hash,operation,state,phase,attempt,input_path,output_path,output,created_at,started_at,expires_at)
    values(row_id,owner,gen_random_uuid(),'{"private":"filename"}',repeat('a',64),'compress','completed','done',1,owner||'/'||row_id||'/input/0.pdf',owner||'/'||row_id||'/output/result.pdf','{"name":"result.pdf","size":1000,"pages":1,"type":"application/pdf"}',now()-interval '6 days',now()-interval '6 days',now()-interval '5 days'+n*interval '1 second');
  end loop;
  j:=public.docflow_job_action('read',jsonb_build_object('owner',owner,'job',target));
  if j->>'state'<>'expired' or j->'output'<>'null'::jsonb or j->'request'<>'{}'::jsonb then raise exception 'Target read returned an overdue completed result beyond the batch'; end if;
end $test$;
rollback;
select jsonb_build_object('target_expiry','passed','persisted_jobs',(select count(*) from public.docflow_jobs),'persisted_probe_users',(select count(*) from auth.users where email like 'docflow-target-probe-%@example.invalid')) as evidence;
