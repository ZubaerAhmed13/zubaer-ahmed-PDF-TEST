begin;
set local statement_timeout='10s';
set local lock_timeout='3s';
do $$begin
  assert not has_function_privilege('anon','public.docflow_cleanup_authorize(text)','EXECUTE');
  assert not has_function_privilege('authenticated','public.docflow_cleanup_authorize(text)','EXECUTE');
  assert not has_function_privilege('authenticated','docflow_private.dispatch_processing_cleanup()','EXECUTE');
end$$;
set local role service_role;
do $$begin
  update docflow_private.processing_config set cleanup_hash=repeat('a',64),cleanup_until=now()+interval '60 seconds',cleanup_consumed=false where singleton;
  assert not public.docflow_cleanup_authorize(repeat('b',64)),'Wrong maintenance token authorized';
  assert public.docflow_cleanup_authorize(repeat('a',64)),'Current maintenance token rejected';
  assert not public.docflow_cleanup_authorize(repeat('a',64)),'Maintenance token replay accepted';
  update docflow_private.processing_config set cleanup_until=now()-interval '1 second',cleanup_consumed=false where singleton;
  assert not public.docflow_cleanup_authorize(repeat('a',64)),'Expired maintenance token accepted';
end$$;
reset role;
rollback;
