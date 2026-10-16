-- Run on a disposable/local Supabase database, or through the authorised project SQL connection.
-- All synthetic users/preferences are rolled back. This is an RLS test, not an Auth login test.
begin;
select set_config('docflow.test.user_a', gen_random_uuid()::text, true);
select set_config('docflow.test.user_b', gen_random_uuid()::text, true);
insert into auth.users (id, email) values
  (current_setting('docflow.test.user_a')::uuid, 'r0-a-' || current_setting('docflow.test.user_a') || '@example.invalid'),
  (current_setting('docflow.test.user_b')::uuid, 'r0-b-' || current_setting('docflow.test.user_b') || '@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('docflow.test.user_a'), true);
do $checks$
begin
  if has_table_privilege(current_user, 'public.docflow_preferences', 'TRUNCATE')
    or has_table_privilege(current_user, 'public.docflow_preferences', 'TRIGGER')
    or has_table_privilege(current_user, 'public.docflow_preferences', 'REFERENCES') then
    raise exception 'Authenticated users have unnecessary table privileges';
  end if;
  insert into public.docflow_preferences (user_id, favorite_tools) values (auth.uid(), array['merge']);
  update public.docflow_preferences set favorite_tools = array['rotate'] where user_id = auth.uid();
  if (select favorite_tools from public.docflow_preferences where user_id = auth.uid()) <> array['rotate']::text[] then
    raise exception 'Own preference update failed';
  end if;
  begin
    insert into public.docflow_preferences(user_id) values (current_setting('docflow.test.user_b')::uuid);
    raise exception 'Cross-user insert was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.docflow_preferences set user_id = current_setting('docflow.test.user_b')::uuid where user_id = auth.uid();
    raise exception 'Ownership reassignment was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.docflow_preferences set recent_tools = array_fill('merge'::text, array[7]) where user_id = auth.uid();
    raise exception 'Oversized recent list was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.docflow_preferences set favorite_tools = array_fill('merge'::text, array[31]) where user_id = auth.uid();
    raise exception 'Oversized favorites list was accepted';
  exception when check_violation then null;
  end;
end $checks$;
reset role;
insert into public.docflow_preferences (user_id, favorite_tools)
values (current_setting('docflow.test.user_b')::uuid, array['split']);
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('docflow.test.user_a'), true);
do $checks$
declare affected integer;
begin
  if exists(select 1 from public.docflow_preferences where user_id = current_setting('docflow.test.user_b')::uuid) then
    raise exception 'Cross-user SELECT exposed another row';
  end if;
  update public.docflow_preferences set favorite_tools = array['crop'] where user_id = current_setting('docflow.test.user_b')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Cross-user UPDATE changed another row'; end if;
  delete from public.docflow_preferences where user_id = current_setting('docflow.test.user_b')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Cross-user DELETE changed another row'; end if;
  insert into public.docflow_preferences(user_id, recent_tools) values(auth.uid(), array['preview'])
  on conflict(user_id) do update set recent_tools = excluded.recent_tools;
  if (select recent_tools from public.docflow_preferences where user_id=auth.uid()) <> array['preview']::text[] then
    raise exception 'Own upsert failed';
  end if;
end $checks$;
select set_config('request.jwt.claim.sub', current_setting('docflow.test.user_b'), true);
do $checks$
begin
  if (select count(*) from public.docflow_preferences) <> 1
     or not exists(select 1 from public.docflow_preferences where user_id=auth.uid()) then
    raise exception 'Second-user isolation failed';
  end if;
  delete from public.docflow_preferences where user_id=auth.uid();
end $checks$;
set local role anon;
do $checks$
begin
  begin
    perform 1 from public.docflow_preferences;
    raise exception 'Anonymous SELECT was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.docflow_preferences(user_id) values(current_setting('docflow.test.user_b')::uuid);
    raise exception 'Anonymous INSERT was accepted';
  exception when insufficient_privilege then null;
  end;
end $checks$;
reset role;
rollback;
select json_build_object('rls_checks', 'passed', 'synthetic_data', 'rolled back',
  'real_auth_login', 'not tested', 'remaining_auth_users', (select count(*) from auth.users),
  'remaining_preference_rows', (select count(*) from public.docflow_preferences)) as r0_result;

