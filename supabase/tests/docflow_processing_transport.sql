begin;
do $$begin
  assert to_regprocedure('public.docflow_processing_configuration()') is not null,'Transport configuration RPC is missing';
  assert to_regprocedure('public.docflow_cleanup_claim(integer)') is not null,'Physical cleanup claim RPC is missing';
  assert not has_function_privilege('anon','public.docflow_processing_configuration()','EXECUTE'),'Anonymous configuration access';
  assert not has_function_privilege('authenticated','public.docflow_processing_configuration()','EXECUTE'),'Authenticated configuration access';
  assert not has_function_privilege('authenticated','public.docflow_cleanup_claim(integer)','EXECUTE'),'End-user cleanup access';
  assert not has_table_privilege('authenticated','docflow_private.processing_config','SELECT'),'End-user config table access';
end$$;
set local role service_role;
do $$declare config jsonb; first_claim jsonb; second_claim jsonb;begin
  config:=public.docflow_processing_configuration();
  assert (config->>'enabled')::boolean=false,'New transport must be disabled';
  first_claim:=public.docflow_cleanup_claim(100);
  assert not (first_claim->>'busy')::boolean,'First maintenance claim is unavailable';
  second_claim:=public.docflow_cleanup_claim(100);
  assert (second_claim->>'busy')::boolean,'Concurrent maintenance was not fenced';
  assert not public.docflow_cleanup_ack(gen_random_uuid(),true,0),'A stale cleanup acknowledged a newer lease';
  assert public.docflow_cleanup_ack((first_claim->>'lease')::uuid,true,0),'The current cleanup did not acknowledge';
  config:=public.docflow_processing_configuration();
  assert (config->>'cleanupReady')::boolean,'Successful cleanup did not enable its health gate';
  begin perform public.docflow_cleanup_claim(101);raise exception 'Oversized cleanup accepted';exception when raise_exception then assert sqlerrm='Invalid cleanup batch size';end;
end$$;
reset role;
rollback;
