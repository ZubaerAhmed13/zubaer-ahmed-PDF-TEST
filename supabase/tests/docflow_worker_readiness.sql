-- Roll back synthetic changes to the private singleton rows after probing.
begin;
set local role service_role;
do $$
declare
  worker text;
  token_hash text := repeat('a', 64);
  checked_at timestamptz;
  owner uuid;
  payload jsonb;
begin
  assert not has_function_privilege('anon', 'public.docflow_record_worker_check(text,text,boolean,timestamptz)', 'EXECUTE');
  assert not has_function_privilege('authenticated', 'public.docflow_record_worker_check(text,text,boolean,timestamptz)', 'EXECUTE');
  assert has_function_privilege('service_role', 'public.docflow_record_worker_check(text,text,boolean,timestamptz)', 'EXECUTE');

  update docflow_private.processing_config
     set cleanup_hash=token_hash, cleanup_until=now()+interval '60 seconds', cleanup_consumed=false
   where singleton returning worker_url, allowed_owners[1] into worker, owner;
  assert owner is not null;
  payload := jsonb_build_object('owner',owner,'job',gen_random_uuid());
  assert not public.docflow_record_worker_check(worker, token_hash, true, null);
  update docflow_private.processing_config set cleanup_consumed=true where singleton;
  assert not public.docflow_record_worker_check(worker, repeat('b', 64), true, null);
  assert not public.docflow_record_worker_check('https://docflow-processing-staging-other.vercel.app', token_hash, true, null);

  assert public.docflow_record_worker_check(worker, token_hash, true, now()+interval '4 minutes');
  assert (select worker_ready_until=now()+interval '1 minute' and worker_checked_url=worker
    from docflow_private.processing_maintenance where singleton);
  assert (public.docflow_processing_configuration()->>'workerReady')::boolean;

  assert not public.docflow_record_worker_check(worker, token_hash, true, now()+interval '2 minutes');
  assert not (public.docflow_processing_configuration()->>'workerReady')::boolean;

  assert public.docflow_record_worker_check(worker, token_hash, true, null);
  assert (select worker_ready_until=worker_checked_at+interval '10 minutes' and worker_snapshot_expires_at is null
    from docflow_private.processing_maintenance where singleton);

  -- Permit only the fresh, exact worker, with the worker and cleanup
  -- rechecked under the same job lock before an actual job write.
  update docflow_private.processing_maintenance set last_ok_at=clock_timestamp(), last_failed=false where singleton;
  begin
    perform public.docflow_admit_job('start',payload,'https://docflow-processing-staging-other.vercel.app');
    raise exception 'Wrong worker passed admission';
  exception when raise_exception then
    assert sqlerrm='Processing worker unavailable', sqlerrm;
  end;
  begin
    perform public.docflow_admit_job('start',payload,worker);
    raise exception 'Missing job passed start';
  exception when raise_exception then
    assert sqlerrm='Job not found', sqlerrm;
  end;
  update docflow_private.processing_maintenance set worker_ready_until=now() where singleton;
  begin
    perform public.docflow_admit_job('start',payload,worker);
    raise exception 'Stale readiness passed admission';
  exception when raise_exception then
    assert sqlerrm='Processing worker unavailable', sqlerrm;
  end;
  assert not (public.docflow_processing_configuration()->>'workerReady')::boolean;
  assert public.docflow_record_worker_check(worker, token_hash, true, null);
  assert not public.docflow_record_worker_check(worker, token_hash, false, null);
  assert not (public.docflow_processing_configuration()->>'workerReady')::boolean;

  select worker_checked_at into checked_at from docflow_private.processing_maintenance where singleton;
  update docflow_private.processing_config set cleanup_until=now() where singleton;
  assert not public.docflow_record_worker_check(worker, token_hash, true, null);
  assert (select worker_checked_at=checked_at and worker_ready_until is null
    from docflow_private.processing_maintenance where singleton);
end $$;
rollback;
