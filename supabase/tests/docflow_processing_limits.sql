-- Synthetic control-plane probes only. No Storage objects or VMs are created.
-- Refuse to touch a project with real processing jobs; everything rolls back.
begin;
select pg_advisory_xact_lock(642051830017::bigint);
do $test$
declare
  owners uuid[] := array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  jobs uuid[] := array[]::uuid[];
  owner uuid; j jsonb; claimed jsonb; output jsonb; bad jsonb; i integer;
  request jsonb := jsonb_build_object('operation','compress','files',jsonb_build_array(jsonb_build_object('name','source.pdf','type','application/pdf','size',100,'sha256',repeat('a',64))),'options',jsonb_build_object('jpegQuality',85,'dpi',150,'maxImagePixels',2200),'consent',jsonb_build_object('accepted',true,'noticeVersion','2026-10-24'));
begin
  if exists(select 1 from public.docflow_jobs) then raise exception 'Probe requires empty docflow_jobs; refusing real-job changes'; end if;
  foreach owner in array owners loop
    insert into auth.users(id,email) values(owner,'docflow-lifecycle-probe-'||owner||'@example.invalid');
    j := public.docflow_job_action('create',jsonb_build_object('owner',owner,'idempotencyKey',gen_random_uuid(),'requestHash',repeat('a',64),'request',request));
    jobs := array_append(jobs,(j->>'id')::uuid);
    perform public.docflow_job_action('start',jsonb_build_object('owner',owner,'job',j->>'id','claimHash',repeat('b',64)));
  end loop;
  begin
    perform public.docflow_job_action('create',jsonb_build_object('owner',owners[1],'idempotencyKey',gen_random_uuid(),'requestHash',repeat('a',64),'request',request));
    raise exception 'Owner active-job quota was bypassed';
  exception when others then if sqlerrm <> 'Owner active job limit reached' then raise; end if; end;
  perform public.docflow_job_action('claim',jsonb_build_object('job',jobs[1],'claimHash',repeat('b',64)));
  perform public.docflow_job_action('claim',jsonb_build_object('job',jobs[2],'claimHash',repeat('b',64)));
  update docflow_private.job_claims set claim_until=now()-interval '1 second' where job_id=jobs[3];
  begin
    perform public.docflow_job_action('claim',jsonb_build_object('job',jobs[3],'claimHash',repeat('b',64)));
    raise exception 'Expired claim was accepted';
  exception when others then if sqlerrm <> 'Claim rejected' then raise; end if; end;
  perform public.docflow_job_action('start',jsonb_build_object('owner',owners[3],'job',jobs[3],'claimHash',repeat('b',64)));
  begin
    perform public.docflow_job_action('claim',jsonb_build_object('job',jobs[3],'claimHash',repeat('b',64)));
    raise exception 'Concurrent-job quota was bypassed';
  exception when others then if sqlerrm <> 'Global processing limit reached' then raise; end if; end;
  update public.docflow_jobs set lease_until=now()-interval '1 second' where id=jobs[1];
  begin
    perform public.docflow_job_action('finish',jsonb_build_object('job',jobs[1],'claimHash',repeat('b',64),'attempt',1,'outcome','completed'));
    raise exception 'Expired worker lease published a result';
  exception when others then if sqlerrm not in ('Result publication rejected','Worker lease rejected') then raise; end if; end;
  perform public.docflow_job_action('claim',jsonb_build_object('job',jobs[3],'claimHash',repeat('b',64)));
  -- Preserve history while removing only our synthetic active jobs.
  update public.docflow_jobs set state='expired',phase='done',output=null,output_path=null,started_at=now()-interval '25 hours' where id=any(jobs);
  for i in 1..10 loop
    j := public.docflow_job_action('create',jsonb_build_object('owner',owners[1],'idempotencyKey',gen_random_uuid(),'requestHash',repeat('a',64),'request',request));
    perform public.docflow_job_action('start',jsonb_build_object('owner',owners[1],'job',j->>'id','claimHash',repeat('c',64)));
    perform public.docflow_job_action('claim',jsonb_build_object('job',j->>'id','claimHash',repeat('c',64)));
    perform public.docflow_job_action('finish',jsonb_build_object('job',j->>'id','claimHash',repeat('c',64),'attempt',1,'outcome','failed','errorCode','engine_error'));
  end loop;
  j := public.docflow_job_action('create',jsonb_build_object('owner',owners[1],'idempotencyKey',gen_random_uuid(),'requestHash',repeat('a',64),'request',request));
  perform public.docflow_job_action('start',jsonb_build_object('owner',owners[1],'job',j->>'id','claimHash',repeat('d',64)));
  begin
    perform public.docflow_job_action('claim',jsonb_build_object('job',j->>'id','claimHash',repeat('d',64)));
    raise exception 'Daily-start quota was bypassed';
  exception when others then if sqlerrm <> 'Daily processing quota reached' then raise; end if; end;
  update public.docflow_jobs set started_at=now()-interval '24 hours' where state='failed';
  claimed := public.docflow_job_action('claim',jsonb_build_object('job',j->>'id','claimHash',repeat('d',64)));
  if claimed->>'state' <> 'running' then raise exception 'Rolling quota did not release after 24 hours'; end if;
  output := jsonb_build_object('name','result.pdf','type','application/pdf','size',1000,'pages',1,'sha256',repeat('e',64));
  foreach bad in array array[output||'{"size":52428801}'::jsonb,output||'{"size":0}'::jsonb,output||'{"pages":0}'::jsonb,output||'{"pages":101}'::jsonb,output||'{"sha256":"bad"}'::jsonb,output||'{"name":"other.pdf"}'::jsonb,output||'{"type":"text/plain"}'::jsonb] loop
    begin
      perform public.docflow_job_action('finish',jsonb_build_object('job',j->>'id','claimHash',repeat('d',64),'attempt',1,'outcome','completed','output',bad));
      raise exception 'Malformed output was accepted';
    exception when others then if sqlerrm <> 'Invalid verified output' then raise; end if; end;
  end loop;
  j := public.docflow_job_action('finish',jsonb_build_object('job',j->>'id','claimHash',repeat('d',64),'attempt',1,'outcome','completed','output',output));
  if j->>'state' <> 'completed' or j->'output' <> output then raise exception 'Valid-output control failed'; end if;
end $test$;
rollback;
select jsonb_build_object('limit_probes','passed','persisted_jobs',(select count(*) from public.docflow_jobs),'persisted_probe_users',(select count(*) from auth.users where email like 'docflow-lifecycle-probe-%@example.invalid')) as evidence;
