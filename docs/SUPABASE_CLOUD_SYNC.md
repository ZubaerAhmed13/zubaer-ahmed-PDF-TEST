# DocFlow — optional Supabase preference sync

## Project

- Supabase account: WeekWise; separate project: DocFlow.
- Project ref: ruefkvkavvycposzahit.
- Region: eu-central-1 (Frankfurt).
- Frontend: https://zubaerahmed13.github.io/zubaer-ahmed-PDF-TEST/.
- Frontend key in .env.production is a public publishable key, not a secret. Never place service_role/secret keys in frontend code.

## Database

Migration docflow_preferences_private_sync was applied to DocFlow, not Weekwise.
Table public.docflow_preferences contains only user_id, favorite_tools (30 max), recent_tools (6 max), and updated_at.
RLS enabled, four owner-only policies, no anonymous privileges. No PDFs, filenames, document text, form values or passwords.

## One-time Auth setup

In Supabase Authentication > URL Configuration set Site URL to:
https://zubaerahmed13.github.io/zubaer-ahmed-PDF-TEST/

Allow the same exact redirect URL. Email delivery depends on Supabase email provider setup/quotas.

## How to sync

Cloud Sync is optional. Without signing in, all existing PDF tools continue to work locally.
Open Cloud sync from the header, sign in or create an account, and manually Save preferences.
On another browser/device, sign in and Restore preferences. Restore replaces only local favorites and recent tools.

The Supabase Auth session is stored in browser sessionStorage for this tab, not localStorage.
Supabase is contacted only when you explicitly interact with cloud preferences. Document content and local recovery state are not sent.

## Verification boundary

R0's live database transaction checks pass own-row CRUD/upsert, denied cross-user access/reassignment, array limits and anonymous denial. All synthetic users/rows are rolled back. Authenticated browser roles now have SELECT/INSERT/UPDATE/DELETE only; TRUNCATE/REFERENCES/TRIGGER were revoked. Source migrations and tests are in supabase/.

Mocked browser Auth/API tests establish payload/UI behaviour, not actual Auth login or email delivery. The live project currently has no Auth users. Real email confirmation, password sign-in, Save/Restore across two browser sessions, expired-session refresh and sign-out remain independent acceptance work. Auth Site URL/redirect settings also require direct confirmation.

### Real-account acceptance
1. Use your own confirmed DocFlow account in the Cloud sync panel. Never send credentials in chat.
2. Choose a distinctive favourite, Save, then sign in in a second browser and Restore. Verify only favourites/recent tool IDs changed.
3. Sign out and check local PDF tools still work; repeat with the network unavailable.
4. With disposable test accounts only, verify the REST API rejects access to another account's preferences. The rollback SQL test already covers database policy behaviour.
5. Record the tested build/date and outcome. Do not label mocked tests or database role tests as a real browser login.

See R0_RELEASE.md for current recorded evidence. The initial schema migration was reconstructed from the live catalog for reproducible fresh installs; its original remote migration identity is retained. Do not reset production to replay it.
