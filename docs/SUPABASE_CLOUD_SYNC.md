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

Schema/row ownership protections verified by the database tools.
Production GitHub Actions and a real authenticated two-device sync roundtrip remain necessary before declaring this feature release-ready.
