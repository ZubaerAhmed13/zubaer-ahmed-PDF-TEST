-- Tie worker readiness to the authenticated cleanup dispatch and exact worker
-- deployment. Keep the measurement private and let it expire if cron stalls.
alter table docflow_private.processing_maintenance
  add column worker_checked_url text,
  add column worker_checked_at timestamptz,
  add column worker_ready_until timestamptz,
  add column worker_snapshot_expires_at timestamptz;

create function public.docflow_record_worker_check(
  p_worker_url text,
  p_cleanup_hash text,
  p_ready boolean,
  p_expires_at timestamptz
) returns boolean
language plpgsql security invoker set search_path='' as $$
declare
  ready_until timestamptz;
  recorded_until timestamptz;
  token_until timestamptz;
  checked_at timestamptz;
begin
  -- Lock the matching configuration before writing the measurement. A newer
  -- dispatch or changed worker can win while this function is waiting.
  select c.cleanup_until into token_until from docflow_private.processing_config c
   where c.singleton and c.worker_url = p_worker_url
     and c.cleanup_hash = p_cleanup_hash and c.cleanup_consumed
   for no key update;
  checked_at := clock_timestamp();
  if token_until is null or token_until <= checked_at then return false; end if;

  if p_ready is true then
    -- A result covers at most two scheduled ticks and leaves time for a
    -- 180-second job to complete before a finite snapshot expiry.
    ready_until := least(checked_at + interval '10 minutes',
      coalesce(p_expires_at - interval '3 minutes', 'infinity'::timestamptz));
  end if;
  update docflow_private.processing_maintenance m
     set worker_checked_url = p_worker_url,
         worker_checked_at = checked_at,
         worker_ready_until = ready_until,
         worker_snapshot_expires_at = p_expires_at
   where m.singleton
  returning m.worker_ready_until into recorded_until;
  return coalesce(recorded_until > clock_timestamp(), false);
end;
$$;
revoke all on function public.docflow_record_worker_check(text,text,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.docflow_record_worker_check(text,text,boolean,timestamptz) to service_role;

create or replace function public.docflow_processing_configuration() returns jsonb
language sql security invoker set search_path='' as $$
  select jsonb_build_object('enabled',c.enabled,'workerUrl',c.worker_url,
    'workerBypass',coalesce(s.decrypted_secret,''),'cleanupHash',coalesce(c.cleanup_hash,''),
    'allowedOwners',to_jsonb(c.allowed_owners),'allowedOrigins',to_jsonb(c.allowed_origins),
    'cleanupReady',coalesce(m.last_ok_at>now()-interval '10 minutes' and not m.last_failed,false),
    'workerReady',coalesce(m.worker_checked_url=c.worker_url and m.worker_ready_until>now(),false))
  from docflow_private.processing_config c
  join docflow_private.processing_maintenance m on m.singleton=c.singleton
  left join vault.decrypted_secrets s on s.id=c.worker_secret_id
  where c.singleton;
$$;

-- Admission and the job write share a transaction. Check again after network
-- validation and after waiting for the existing job/cleanup lock.
create function public.docflow_admit_job(p_action text, p_payload jsonb, p_worker_url text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  config docflow_private.processing_config;
  maintenance docflow_private.processing_maintenance;
  checked_at timestamptz;
begin
  if p_action is null or p_action not in ('create','start') then
    raise exception 'Invalid processing admission action';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(642051830017::bigint);
  select * into strict config from docflow_private.processing_config where singleton for share;
  select * into strict maintenance from docflow_private.processing_maintenance where singleton for share;
  checked_at := clock_timestamp();
  if maintenance.last_failed or maintenance.last_ok_at is null
      or maintenance.last_ok_at <= checked_at - interval '10 minutes' then
    raise exception 'Processing cleanup unavailable';
  end if;
  if not config.enabled and not coalesce((p_payload->>'owner')::uuid = any(config.allowed_owners), false) then
    raise exception 'Processing disabled';
  end if;
  if p_worker_url is distinct from config.worker_url
      or maintenance.worker_checked_url is distinct from config.worker_url
      or maintenance.worker_ready_until is null or maintenance.worker_ready_until <= checked_at then
    raise exception 'Processing worker unavailable';
  end if;

  return public.docflow_job_action(p_action, p_payload);
end;
$$;
revoke all on function public.docflow_admit_job(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.docflow_admit_job(text,jsonb,text) to service_role;
