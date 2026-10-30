-- pg_net headers are readable to database roles on hosted Supabase. Queue only
-- a one-use cleanup token, never a lasting credential or the worker bypass.
alter table docflow_private.processing_config add column cleanup_until timestamptz;
alter table docflow_private.processing_config add column cleanup_consumed boolean not null default true;
grant update(cleanup_hash,cleanup_until,cleanup_consumed) on docflow_private.processing_config to service_role;
create policy processing_cleanup_auth_service on docflow_private.processing_config for update to service_role using(true) with check(true);

create function public.docflow_cleanup_authorize(p_hash text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then return false;end if;
  update docflow_private.processing_config set cleanup_consumed=true where singleton
    and cleanup_hash=p_hash and cleanup_until>now() and not cleanup_consumed;
  get diagnostics changed=row_count;return changed=1;
end$$;
revoke all on function public.docflow_cleanup_authorize(text) from public,anon,authenticated;
grant execute on function public.docflow_cleanup_authorize(text) to service_role;

create or replace function docflow_private.dispatch_processing_cleanup() returns bigint
language plpgsql security invoker set search_path='' as $$
declare token text;
begin
  token:=encode(extensions.gen_random_bytes(32),'hex');
  update docflow_private.processing_config set cleanup_hash=encode(extensions.digest(token,'sha256'),'hex'),
    cleanup_until=now()+interval '60 seconds',cleanup_consumed=false where singleton;
  return net.http_post(
    url:='https://ruefkvkavvycposzahit.supabase.co/functions/v1/docflow-processing/maintenance',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),
    body:='{}'::jsonb,timeout_milliseconds:=30000
  );
end$$;

-- Retire only the superseded application cleanup secret. The protected worker
-- bypass stays encrypted in Vault and is never passed through pg_net.
do $$declare obsolete uuid;begin
  select maintenance_secret_id into obsolete from docflow_private.processing_config where singleton;
  update docflow_private.processing_config set maintenance_secret_id=null,cleanup_hash=null where singleton;
  if obsolete is not null then delete from vault.secrets where id=obsolete;end if;
end$$;
