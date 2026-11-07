# Authenticated processing transport

Continue inline from the approved processing-backend design and implementation plan. The user explicitly requested completion; routine implementation/deployment is authorised. Preserve draft PR #36 and do not advertise a remote capability before actual authenticated output and cleanup acceptance.

## Task 1 — HTTP broker and worker lifecycle

- [x] Write failing portable tests for authenticated ownership, bounded bodies, canonical requests, exact Storage paths, short downloads, claim/CAS cancellation and safe error responses.
- [x] Implement a Web-standard broker using the existing service-only job RPC and private Storage API. End-user JWTs are verified by Supabase Auth, never decoded as authority. Worker calls use hashed per-job claims; no provider credential enters a VM.
- [x] Implement a separately testable worker coordinator: claim, bounded/hash-verified download, pinned offline VM, attach/cancel, fixed job paths/argv, bounded verified output, stop, private upload and guarded completion. Test duplicate/rejected claims, stop/error cleanup and cancellation races.

## Task 2 — durable cleanup and hosted configuration

- [x] Create a CLI-generated migration for service-only transport configuration and bounded, progressing physical cleanup candidates. Select actual stored objects so historical empty job rows cannot starve cleanup. Delete objects only through the Storage API; keep quota history and cover the two-hour signed-write replay window.
- [x] Keep Vercel deployment protection. Store its narrowly scoped automation credential in Supabase Vault and keep backend maintenance credentials server-side. Add a protected scheduled cleanup endpoint; do not broaden frontend access.
- [x] Apply and run transactional ownership/cleanup/RLS tests; check advisors. Deploy the exact source using the already measured engine snapshot while it remains valid.

## Task 3 — real authenticated acceptance

- [x] Use disposable synthetic accounts/documents to verify create/upload/start/poll/download, owner isolation, real OCR/Office/compression outputs, cancellation stopping the actual VM, expiry, replay cleanup and failure recovery. Never email synthetic accounts or use a real user document.
- [ ] Record measured output artifacts, actual limits, cost/resource bounds and remaining fidelity classes. Keep user uploads disabled until these gates pass.

## Task 4 — v2 processing UI and release acceptance

- [ ] Add explicit provider/upload/retention notice, authentication, typed adapter, options, cancellable progress, reviewed output/download, retry and return-to-editing. Connect OCR only after verified service acceptance.
- [ ] Run appropriate units, independent output checks, three-browser journeys and a fresh code review. Continue the existing broader capability/device/accessibility/fidelity and legacy-parity acceptance; do not label scripted/browser-only evidence as physical-device or manual screen-reader acceptance.

## Decisions

- The broker remains a Supabase Edge Function as designed. The Vercel worker keeps its protection and validates an opaque claim before allocating a VM.
- Worker/input/output callbacks cannot choose an arbitrary URL, owner, SQL action, file path or executable. Snapshot source hashes are verified before processing.
- Cleanup is application maintenance, not a ChatGPT reminder. Its state/progress must survive request failures and invocations.
- Hosted Supabase preserves public grants on the pg_net queue; revoking them is ineffective. Scheduled calls therefore use an atomic, single-use token valid for 60 seconds, with only its hash stored privately. The worker bypass never enters this queue. The former lasting cleanup credential was retired.
- Staging broker v2 and three configuration/cleanup migrations are deployed. Actual hosted maintenance returned 200, consumed its token, and acknowledged cleanup health. A named application cron invokes cleanup every five minutes. No document processing is enabled. Portable transport review found no critical/important issues; execution/upload cancellation, real-object replay and concurrent-start acceptance remain required.
- Do not rely on the development container for isolation or privileged hosted acceptance. Use the actual staged service and keep credentials out of source, artifacts and logs.
