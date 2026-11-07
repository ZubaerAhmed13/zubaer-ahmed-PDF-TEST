-- Bounded application retention maintenance, with a narrowly scoped credential.
create extension if not exists pg_net;
create extension if not exists pg_cron;
-- pg_net briefly queues plaintext headers. Hosted Supabase can preserve public
-- grants despite this least-privilege request. The following credentials
-- migration therefore replaces lasting headers with one-use, 60-second tokens.
revoke all on net.http_request_queue,net._http_response from public,anon,authenticated;

create function docflow_private.dispatch_processing_cleanup() returns bigint
language plpgsql security invoker set search_path='' as $$
declare secret text;
begin
  select s.decrypted_secret into secret from docflow_private.processing_config c
    join vault.decrypted_secrets s on s.id=c.maintenance_secret_id where c.singleton;
  if secret is null or secret !~ '^[a-f0-9]{64}$' then raise exception 'Cleanup credential is not configured';end if;
  return net.http_post(
    url:='https://ruefkvkavvycposzahit.supabase.co/functions/v1/docflow-processing/maintenance',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),
    body:='{}'::jsonb,timeout_milliseconds:=30000
  );
end$$;
revoke all on function docflow_private.dispatch_processing_cleanup() from public,anon,authenticated;
grant execute on function docflow_private.dispatch_processing_cleanup() to service_role;

-- Activate only after the deployed endpoint has acknowledged a real invocation.
-- The named cron job is installed by the release acceptance step, never with a
-- literal secret in its command. Fresh projects remain closed until configured.
