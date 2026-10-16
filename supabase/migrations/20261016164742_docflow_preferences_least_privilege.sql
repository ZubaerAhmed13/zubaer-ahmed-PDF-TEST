-- RLS does not govern TRUNCATE. Signed-in browser users need CRUD only.
-- This does not remove rows or change ownership policies.
revoke all on public.docflow_preferences from anon, authenticated;
grant select, insert, update, delete on public.docflow_preferences to authenticated;

