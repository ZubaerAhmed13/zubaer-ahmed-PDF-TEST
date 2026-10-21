# DocFlow remaining-stage delivery

User instruction, 22 October 2026: finish all remaining stages one by one and continue after deployment. Existing workflow-quality slice is published in draft PR #36 at 56b7a9d.

1. **Existing text/image editing — implemented; publication/CI in progress.** Actual source replacement/removal, supported-font choice, byte-rendered preview, shared history and pending-input guards. Local checks: 191 unit tests, 38 v2 Chromium cases, 30-document corpus and 26 independent raster-preservation pairs pass. A fresh reviewer reproduced five defects, then independently verified their fixes. Vite 6.4.5/Vitest 4.1.12 are pinned; audit reports zero vulnerabilities. [Acceptance and limits](NATIVE_CONTENT_ACCEPTANCE.md). Spec/plan: docs/superpowers/specs/2026-10-22-native-content.md and docs/superpowers/plans/2026-10-22-native-content.md.
2. **Processing backend — queued.** Real Office conversion, broader compression and OCR, secure job lifecycle, measured staging outputs. Existing issue #38 supplies the contract. Discover available compute before choosing a hosted target; Supabase coordinates jobs/storage rather than running heavyweight binaries.
3. **Seven missing tools — queued.** Reader, secure redaction, OCR, embedded-image extraction, visual signature, workflows and batch; preserve and reuse proven domain engines with new v2 views and actual output tests.
4. **Release validation and deployment — queued.** Port regression scenarios, complete capability/device/accessibility/security/fidelity checks, deploy the exact verified source, independently smoke-test production, then continue remaining roadmap acceptance.

Every verified milestone is committed and published with current status/evidence so progress survives workspace maintenance. Do not mark a tool complete merely because controls render, or a backend complete merely because an endpoint returns HTTP 200. Keep difficult/unsupported PDF cases and external hosting prerequisites explicit.

5. **Ongoing improvement rounds — required after the planned stages.** Revisit actual output fidelity, device usability, keyboard/screen-reader access, performance and failure/recovery scenarios. Record concrete defects, reproduce each with evidence, fix and verify before advancing. Keep the next improvement backlog current; deployment does not end this work.

Next measured improvements after remaining delivery: restore keyboard focus after source-panel repaint, reject oversized uploads from File metadata before reading buffers, stress large decoded-image/history memory, and complete physical-device/assistive-technology acceptance. These are tracked work, not claims of completion.
