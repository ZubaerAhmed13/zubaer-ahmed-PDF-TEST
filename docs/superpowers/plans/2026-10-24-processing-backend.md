# Processing backend implementation plan

Use the existing isolated feature checkout; execute tasks sequentially with real tests and one fresh final review. The user has already authorised implementation and deployment; do not insert routine approval loops.

1. Write failing portable contract tests, implement operation/options/resource validation and worker-claim/output contracts. Pin backend dependencies and inspect the installed Sandbox API. Commit the verified boundary.
2. Implement real Python Office/compression/OCR engines, file scanning, output verification and engine/version manifests. Exercise generated inputs; obtain and test a prepared isolated engine snapshot. Record honest supported/rejected classes and benchmarks.
3. Create a migration with the Supabase CLI. Add owner-readable/server-written jobs, atomic idempotency/quotas/leases and restricted functions; prove RLS and state races. Create a private temporary bucket with upload limits and zero cache lifetime.
4. Implement broker and Sandbox worker, start/claim/status/cancel/complete/expiry paths, private uploads/downloads and cleanup. Test authenticated ownership, duplicate starts, cancellation races, errors, expiry and actual processor outputs on staging.
5. Add the typed ProcessingAdapter and explicit upload notice/progress/results flow only for validated capabilities. Test real browser → broker → VM → verified output, including failures and return/retry behaviour.
6. Run relevant units, independent PDF/fidelity/OCR benchmarks, quota/load/cost checks, three-browser scenarios and security advisors. Obtain a fresh review, fix important findings, publish the exact source and staging evidence.
7. Continue immediately to reader, secure redaction, OCR, embedded-image extraction, signatures, workflows and batch adapters, then full release validation/deployment and subsequent flaw-finding rounds.

Do not mark this stage complete while hosting, authentication, purge/cancellation or actual-output acceptance is missing. If an external prerequisite is unavailable, make the completed work reviewable, record the precise blocker and continue independent authorised stages.
