-- Server-only transport settings. Credentials themselves remain in Vault.
create table docflow_private.processing_config (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  worker_url text not null default 'https://docflow-processing-staging.vercel.app'
    check(worker_url ~ '^https://docflow-processing-staging(-[a-z0-9-]+)?\.vercel\.app$'),
  worker_secret_id uuid references vault.secrets(id),
  maintenance_secret_id uuid references vault.secrets(id),
  cleanup_hash text check(cleanup_hash ~ '^[a-f0-9]{64}$'),
  allowed_owners uuid[] not null default '{}' check(cardinality(allowed_owners)<=2 and array_position(allowed_owners,null) is null),
  allowed_origins text[] not null default array['https://zubaerahmed13.github.io'] check(cardinality(allowed_origins)<=20)
);
create table docflow_private.processing_maintenance (
  singleton boolean primary key default true check(singleton),
  cursor_name text not null default '' check(octet_length(cursor_name)<=200),
  lease_id uuid,
  lease_until timestamptz not null default '-infinity',
  last_run_at timestamptz,
  last_ok_at timestamptz,
  last_deleted integer not null default 0,
  last_failed boolean not null default false
);
insert into docflow_private.processing_config(singleton) values(true);
insert into docflow_private.processing_maintenance(singleton) values(true);
alter table docflow_private.processing_config enable row level security;
alter table docflow_private.processing_maintenance enable row level security;
revoke all on docflow_private.processing_config,docflow_private.processing_maintenance from public,anon,authenticated;
grant usage on schema docflow_private to service_role;
grant select on docflow_private.processing_config to service_role;
grant select,update on docflow_private.processing_maintenance to service_role;
create policy processing_config_service on docflow_private.processing_config for select to service_role using(true);
create policy processing_maintenance_service on docflow_private.processing_maintenance for all to service_role using(true) with check(true);

create function public.docflow_processing_configuration() returns jsonb
language sql security invoker set search_path='' as $$
  select jsonb_build_object('enabled',c.enabled,'workerUrl',c.worker_url,
    'workerBypass',coalesce(s.decrypted_secret,''),'cleanupHash',coalesce(c.cleanup_hash,''),
    'allowedOwners',to_jsonb(c.allowed_owners),'allowedOrigins',to_jsonb(c.allowed_origins),
    'cleanupReady',coalesce(m.last_ok_at>now()-interval '10 minutes' and not m.last_failed,false))
  from docflow_private.processing_config c
  join docflow_private.processing_maintenance m on m.singleton=c.singleton
  left join vault.decrypted_secrets s on s.id=c.worker_secret_id
  where c.singleton;
$$;
revoke all on function public.docflow_processing_configuration() from public,anon,authenticated;
grant execute on function public.docflow_processing_configuration() to service_role;

-- Read Storage metadata, but never delete it through SQL. The broker removes
-- these exact objects using the Storage API, including replay-created orphans.
create view docflow_private.processing_cleanup_objects with(security_invoker=true) as
select o.name from storage.objects o
left join public.docflow_jobs j on j.id::text=split_part(o.name,'/',2) and j.owner_id::text=split_part(o.name,'/',1)
where o.bucket_id='docflow-processing'
  and o.name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/(input/0\.(pdf|docx|pptx|xlsx)|output/result\.pdf)$'
  and (j.id is null or j.state in ('cancelled','failed','expired') or j.expires_at<=now()
    or (j.state in ('running','cancelling') and j.lease_until<=now())
    or (j.state='completed' and o.name=j.input_path));
revoke all on docflow_private.processing_cleanup_objects from public,anon,authenticated;
grant select on docflow_private.processing_cleanup_objects to service_role;

create function public.docflow_cleanup_claim(p_limit integer default 100) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare maintenance docflow_private.processing_maintenance; names text[]; lease uuid;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid cleanup batch size';end if;
  perform pg_catalog.pg_advisory_xact_lock(642051830017::bigint);
  select * into maintenance from docflow_private.processing_maintenance where singleton for update;
  if maintenance.lease_until>now() then return jsonb_build_object('busy',true,'names','[]'::jsonb,'lease',null);end if;
  perform public.docflow_expire_jobs(null,100);
  select coalesce(array_agg(name order by name),'{}') into names from
    (select name from docflow_private.processing_cleanup_objects where name>maintenance.cursor_name order by name limit p_limit) candidates;
  if cardinality(names)=0 and maintenance.cursor_name<>'' then
    select coalesce(array_agg(name order by name),'{}') into names from
      (select name from docflow_private.processing_cleanup_objects order by name limit p_limit) candidates;
  end if;
  lease:=gen_random_uuid();
  update docflow_private.processing_maintenance set lease_id=lease,lease_until=now()+interval '60 seconds',
    cursor_name=coalesce(names[cardinality(names)],''),last_run_at=now() where singleton;
  -- Keep rolling quota history for the full day; signed writes issued during
  -- a thirty-minute job have long expired before these tombstones are removed.
  delete from public.docflow_jobs where id in (
    select j.id from public.docflow_jobs j where j.state='expired'
      and j.created_at<now()-interval '24 hours' and coalesce(j.started_at,j.created_at)<now()-interval '24 hours'
      and not exists(select 1 from storage.objects o where o.bucket_id='docflow-processing' and o.name like j.owner_id::text||'/'||j.id::text||'/%')
    order by j.created_at,j.id limit 100 for update skip locked
  );
  return jsonb_build_object('busy',false,'names',to_jsonb(names),'lease',lease);
end$$;
create function public.docflow_cleanup_ack(p_lease uuid,p_ok boolean,p_deleted integer default 0) returns boolean
language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
  if p_ok is null or p_deleted is null or p_deleted not between 0 and 100 then raise exception 'Invalid cleanup acknowledgement';end if;
  update docflow_private.processing_maintenance set lease_until='-infinity',last_failed=not p_ok,
    last_ok_at=case when p_ok then now() else last_ok_at end,last_deleted=p_deleted
    where singleton and lease_id=p_lease and lease_until>now();
  get diagnostics changed=row_count;return changed=1;
end$$;
revoke all on function public.docflow_cleanup_claim(integer),public.docflow_cleanup_ack(uuid,boolean,integer) from public,anon,authenticated;
grant execute on function public.docflow_cleanup_claim(integer),public.docflow_cleanup_ack(uuid,boolean,integer) to service_role;
