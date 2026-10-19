# U1 · v0.11.0 — dedicated document pages

Choose a tool from the compact searchable catalog, select files on its own page, work in the existing editor, and review/download completed outputs on a separate page. All 29 stable IDs and PDF engines remain. Tool routes use stable IDs; result routes use opaque tokens. Filenames and document bytes are never placed in the URL or persisted by the router.

The result store owns at most 256 MiB of transient output references. Changing source, editing again or leaving the current document invalidates results. A reload gives a clear expired-result recovery page. Output names are sanitized and made unique while the original tool remains authoritative for batch/ZIP names. Returning to editing retains the mounted tool, objects and settings. Draft redraws do not automatically reopen old results.

Desktop layouts use the full page with bounded previews. Phone layouts put file/settings panels behind explicit controls, preserve native file pickers, expose object properties in a scrollable sheet and keep export actions reachable. New dialogs are limited to actual confirmations/help; tool workspaces are nonmodal regions. Reduced motion, focus navigation and automated axe checks are included.

## Processing and limits

This UI increment keeps existing browser-local processing and optional preference-only cloud sync. Server processing is permitted when it improves a concrete capability, but no unbenchmarked OCR/Office service, storage retention claim or fake upload option is added here. Existing transformation/preservation, resource and language limits still apply. PDF editing continues to add supported content and native annotations; arbitrary existing page-text replacement is not introduced.

## Verification

Unit, PDF output and browser evidence must be assessed at the PR head SHA. See the [journey suite](../e2e/page-journey.spec.ts), [existing engine regressions](../e2e/) and [upgrade ledger](PAGE_JOURNEY_PROGRESS.md). The GitHub Actions matrix retains Chromium, Firefox and WebKit reports and release artifacts. Local Chromium uses an explicitly configured compatible binary when the pinned browser cannot be downloaded; pinned CI remains the authoritative browser matrix.

Physical devices, manual NVDA/VoiceOver, Safari offline execution, real-account cloud sync and moderated usability acceptance remain unverified. This release is not a claim of completed Office conversion or a complete PDF editor engine replacement.
