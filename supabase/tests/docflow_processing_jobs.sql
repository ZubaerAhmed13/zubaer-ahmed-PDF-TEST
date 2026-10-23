-- Transactional RLS/idempotency/claim/cancellation probes; synthetic records roll back.
begin;
select set_config('docflow.test.owner',gen_random_uuid()::text,true);
select set_config('docflow.test.other',gen_random_uuid()::text,true);
insert into auth.users(id,email) values(current_setting('docflow.test.owner')::uuid,'docflow-processing@example.invalid'),(current_setting('docflow.test.other')::uuid,'docflow-processing-other@example.invalid');
do $test$
declare j jsonb; again jsonb; started jsonb; claimed jsonb; result jsonb; key uuid := gen_random_uuid();
begin
  j := public.docflow_job_action('create',jsonb_build_object('owner',current_setting('docflow.test.owner'),'idempotencyKey',key,'requestHash',repeat('a',64),'request',jsonb_build_object('operation','compress','files',jsonb_build_array(jsonb_build_object('name','source.pdf')))));
  perform set_config('docflow.test.job',j->>'id',true);
  again := public.docflow_job_action('create',jsonb_build_object('owner',current_setting('docflow.test.owner'),'idempotencyKey',key,'requestHash',repeat('a',64)));
  if again->>'id' <> j->>'id' then raise exception 'Idempotency duplicated job'; end if;
  begin
    perform public.docflow_job_action('read',jsonb_build_object('job',j->>'id','owner',current_setting('docflow.test.other')));
    raise exception 'Cross-owner RPC read accepted';
  exception when others then if sqlerrm <> 'Job not found' then raise; end if; end;
  started := public.docflow_job_action('start',jsonb_build_object('owner',current_setting('docflow.test.owner'),'job',j->>'id','claimHash',repeat('b',64)));
  if started->>'dispatch' <> 'true' then raise exception 'Start not dispatched'; end if;
  claimed := public.docflow_job_action('claim',jsonb_build_object('job',j->>'id','claimHash',repeat('b',64)));
  begin
    perform public.docflow_job_action('claim',jsonb_build_object('job',j->>'id','claimHash',repeat('b',64)));
    raise exception 'Duplicate claim accepted';
  exception when others then if sqlerrm <> 'Claim rejected' then raise; end if; end;
  begin
    perform public.docflow_job_action('finish',jsonb_build_object('job',j->>'id','claimHash',repeat('b',64),'attempt',2,'outcome','completed'));
    raise exception 'Stale attempt accepted';
  exception when others then if sqlerrm <> 'Worker lease rejected' then raise; end if; end;
  perform public.docflow_job_action('cancel',jsonb_build_object('owner',current_setting('docflow.test.owner'),'job',j->>'id','cancelHash',repeat('c',64)));
  result := public.docflow_job_action('finish',jsonb_build_object('job',j->>'id','claimHash',repeat('b',64),'attempt',1,'outcome','completed','output',jsonb_build_object('name','result.pdf','type','application/pdf','size',1000,'pages',1,'sha256',repeat('d',64))));
  if result->>'state' <> 'cancelled' or result->'output' <> 'null'::jsonb then raise exception 'Cancellation was overwritten by completion'; end if;
end $test$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('docflow.test.owner'),true);
do $test$
begin
  if (select count(*) from public.docflow_jobs) <> 1 then raise exception 'Owner read failed'; end if;
  if has_table_privilege(current_user,'public.docflow_jobs','INSERT') or has_table_privilege(current_user,'public.docflow_jobs','UPDATE') or has_table_privilege(current_user,'public.docflow_jobs','DELETE') then raise exception 'Owner can mutate worker state'; end if;
  if has_function_privilege(current_user,'public.docflow_job_action(text,jsonb)','EXECUTE') then raise exception 'Owner can execute service RPC'; end if;
end $test$;
select set_config('request.jwt.claim.sub',current_setting('docflow.test.other'),true);
do $test$ begin if exists(select 1 from public.docflow_jobs) then raise exception 'Other owner can read document job'; end if; end $test$;
set local role anon;
do $test$ begin if has_table_privilege(current_user,'public.docflow_jobs','SELECT') then raise exception 'Anonymous job read granted'; end if; end $test$;
rollback;
