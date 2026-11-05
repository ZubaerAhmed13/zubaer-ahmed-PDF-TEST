# Browser processing workspace continuation

Continue draft PR #36 from source 1a865b2. Keep the production release unchanged and normal backend uploads disabled. The published OCR adapter and actual backend transport evidence are the baseline; temporary uncommitted account/recovery work was lost during workspace maintenance and reconstructed with failing-then-passing regressions.

## Requirements and implementation

1. Shared tab-scoped account helpers, generation guards against refresh/sign-in completing after sign-out, credentials omitted on Auth requests, bounded timeouts. Passwords never enter document drafts.
2. Recover the same uncertain create using its canonical idempotency key; retry cancellation after an acknowledgement failure; retrieve only verified completed output without another processing start.
3. One processing session owns the workspace until terminal status is confirmed. Preserve the source after failures. Serialize recovery actions. Check/retrieve recovery waits until the original attempt settles, so early observations cannot unlock a new paid attempt.
4. Device OCR is the default. Server OCR requires a configured build flag, an existing confirmed account, and fresh explicit consent naming Supabase/Vercel and retention. Server mode processes the whole document; local page/correction controls are disabled. Consent is excluded from option snapshots.
5. Navigation awaits real cancellation acknowledgement, shares a pending cancellation between route requests, honors the newest navigation generation, and ignores disposed result callbacks. Unknown status retains the original workspace and account controls.
6. Browser CI uses an invalid, fully intercepted service origin and fake public configuration. Verify consent, actual PDF result review, cancellation uncertainty/retry, completed download retry, same-key unknown-create recovery, and overlapping navigation in Chromium/Firefox/WebKit. Actual hosted processing acceptance remains separate evidence.

## Verification ledger

- Recovered client regressions: cancellation retry, retrieve-only, lost create-body recovery, expiry checks, and completed-job/local-transfer cancellation observed failing before fixes.
- Shared auth regressions: tab session, offline sign-out, refresh, and refresh-after-sign-out pass.
- Session regressions: uncertain attempts cannot restart; retry/late-result disposal; retrieve-only; terminal-release requirement; no concurrent retrieval; no pre-settlement recovery checks. The two timing guards had failing regressions before their fixes.
- Fresh read-only review found no remaining critical/important defects in the combined UI/auth/session diff. A premature check could leave stale `none` status after later uncertain creation; recovery checks now require settled initial work. Concurrent retrieval also waits for that work to settle.
- 279 local unit tests, typecheck, lint, build and provenance checks pass. Browser CI is pending. Do not claim hosted browser-to-backend acceptance.

Ruling: keep normal uploads disabled and expose server mode only via explicit build configuration. The staging snapshot had seven-day retention from 29 October, so its current validity must be reverified before spending a real processing start. No image rebuild or production capacity expansion is implied by UI work.

Deferred minor: switching server → device → server resets automatic deskew/rotation checkboxes. Error/recovery retention is verified separately. Add a browser regression and preserve these toggles in the next UI refinement.

Managed interactive preview returned a Vite allowed-host error for its exact terminal.local URL. No local interactive smoke is claimed; do not weaken runtime security to make the preview pass.
