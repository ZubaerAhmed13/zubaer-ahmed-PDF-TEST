-- Reconstructed canonical baseline for the existing DocFlow project.
-- Preference IDs only. Never add documents or recovery payloads to this table.
create table if not exists public.docflow_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  favorite_tools text[] not null default '{}',
  recent_tools text[] not null default '{}',
  updated_at timestamptz not null default now(),
  constraint docflow_favorite_tools_limit check (coalesce(array_length(favorite_tools, 1), 0) <= 30),
  constraint docflow_recent_tools_limit check (coalesce(array_length(recent_tools, 1), 0) <= 6)
);
alter table public.docflow_preferences enable row level security;
revoke all on public.docflow_preferences from anon, authenticated;
grant select, insert, update, delete on public.docflow_preferences to authenticated;
drop policy if exists docflow_preferences_select_own on public.docflow_preferences;
create policy docflow_preferences_select_own on public.docflow_preferences for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists docflow_preferences_insert_own on public.docflow_preferences;
create policy docflow_preferences_insert_own on public.docflow_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists docflow_preferences_update_own on public.docflow_preferences;
create policy docflow_preferences_update_own on public.docflow_preferences for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists docflow_preferences_delete_own on public.docflow_preferences;
create policy docflow_preferences_delete_own on public.docflow_preferences for delete to authenticated
  using ((select auth.uid()) = user_id);

