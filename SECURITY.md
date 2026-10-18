# Security

## Optional account sync boundary

Cloud sync is opt-in and contacts only the dedicated DocFlow Supabase project. Email/password authentication is performed by Supabase Auth over HTTPS. The browser uses the Supabase publishable key, never a service_role or other secret key. Auth sessions are retained in per-tab sessionStorage. Preference Save/Restore transmits only allow-listed favorite/recent tool IDs; the database has user-scoped RLS. No PDF document bytes, filenames, form fields or local recovery state are transmitted.

The CSP connect-src allows only the dedicated Supabase project in addition to same-origin assets. The DocFlow processing engine itself remains local/offline. Live Auth redirect configuration and real-user roundtrip tests must be completed before production rollout.

## Local processing boundary

The migrated application does not configure remote PDF-processing APIs, telemetry, analytics or trackers. Core libraries are bundled locally. Migrated PDF and image operations execute in the browser, using dedicated workers where applicable.

Protect PDF and Unlock PDF use a vendored qpdf 12.3.2 WebAssembly runtime in a dedicated module worker. The runtime is loaded from the same built application and does not require a CDN or remote processing service.

## qpdf provenance and integrity

The encryption runtime is vendored from `fayazara/pdfstudio` 0.4.0 at immutable upstream commit:

`c5c1f2d9f378199d1e2d333dbe4ca20e9ff737ad`

The embedded engine is qpdf 12.3.2. Wrapper and qpdf licensing are Apache License 2.0. `src/vendor/qpdf/PROVENANCE.md` records the verified upstream Git blob SHAs and SHA-256 values. The qpdf WASM SHA-256 is:

`48a6044e2b5abb32295fa1682e26f20338181bb2423b2ab6e8456b7c4a8c9756`

The one-time importer verified immutable upstream Git blob hashes before committing the runtime and was then removed. Generated vendor code is excluded from first-party ESLint rules but remains pinned by recorded provenance.

## PDF encryption boundary

Protect PDF invokes qpdf with 256-bit encryption and a user-supplied password plus a randomly generated owner password that is never exposed by the UI. Unlock PDF invokes qpdf decryption only after the supplied user or owner password is accepted.

Security workspaces deliberately do **not** use project-recovery autosave. Password values are passed only to the active qpdf worker, password fields are cleared after completion/failure and when the workspace closes, the worker clears its password reference in `finally`, and cancellation terminates the worker. Automated browser tests directly check that the test password is absent from DocFlow localStorage and its project-state IndexedDB store.

Wrong-password failures are surfaced as the structured `INVALID_PASSWORD` category. Missing-password, password-format and malformed-PDF failures have separate structured categories rather than being mislabeled as generic PDF failures.

## CSP

The root document includes a restrictive CSP:

- default/script/style/connect: same origin
- workers: same origin plus blob
- object embedding: disabled
- base URI: same origin
- forms: disabled
- framing: disabled

The policy must be rechecked against the final production build and deployed worker/WASM URLs before release.

## File validation

PDF operations validate the `%PDF-` signature in addition to UI file-type filtering. The shared structural loader also forces lazy page-tree traversal so malformed containers that fail after initial parsing are reported through the structured `INVALID_PDF` boundary. The qpdf worker separately validates the PDF signature before protect/unlock processing.

## Capability boundaries

Local English/German OCR is implemented. Cryptographic digital-signature creation/validation is not implemented. UI and documentation must not describe visual marks, typed names, ordinary watermarks or metadata inspection as cryptographic signatures. Those future capabilities require dedicated engines, threat-model review, fixtures and executed certification.

## Sensitive data

Application logs must not contain document text, passwords or form values. Favorites/recent-tool preferences contain tool identifiers only. Lightweight project recovery may store selected-tool/settings/file metadata in IndexedDB, but document bytes are not intentionally persisted by the recovery layer. Security password fields are excluded from this recovery mechanism entirely.

## Dependency gate

`npm audit` is part of CI for the locked npm dependency graph. The vendored qpdf runtime is not an npm dependency, so its immutable upstream source, license and cryptographic file provenance are tracked separately in `src/vendor/qpdf/PROVENANCE.md`. Audit/provenance evidence applies to the tested versions at that point in time and is not a blanket security guarantee.

## R0 privileges and hosting boundary

The browser-authenticated role has only SELECT, INSERT, UPDATE and DELETE on docflow_preferences. RLS does not constrain TRUNCATE, so default extra privileges were explicitly revoked. No anonymous grants. Reproducible migration and rollback-only ownership tests are in supabase/.

Response inspection on 16 October 2026 found HTTPS/HSTS but no CSP HTTP response header or X-Frame-Options. Meta CSP enforces its supported directives, but frame-ancestors cannot be delivered through meta; the ignored directive was removed. Effective anti-framing protection requires response-header support from the serving infrastructure. It remains an explicit limitation; this release does not change hosting or add JavaScript frame-busting.

## R5 untrusted PDF and export policy

Document inspection is structural and never opens attachment bytes or executes actions. Detection is not malware scanning or cryptographic validation. Every rewrite can invalidate a signed/certified source. Whole-document edits may preserve scripts, actions and attachments; page-copy tools have documented catalog/reference losses. Full raster redaction creates new image-only pages and discards original PDF objects. The per-workspace preservation panel explains these consequences before export. Encrypted/damaged input that cannot be inventoried stays explicitly uninspected.

The pinned PDF.js 4.10.38 API is configured with `isEvalSupported: false`, `enableXfa: false`, `stopAtErrors: true`, a decoded-image limit and `useWorkerFetch: false`; DocFlow configures no scripting sandbox. Strict image errors prevent silently missing image content. Rendering and operation limits are documented in docs/R5_RELEASE.md. Admission and deadline controls do not provide a hard JavaScript/WASM memory sandbox.

## Security maintenance and reproducibility

Before each release, run `npm ci`, `npm audit --audit-level=high`, `npm run verify:provenance`, typecheck/lint/unit/build and the full browser matrix. Review upstream security advisories for the pinned PDF.js, pdf-lib, fontkit, Tesseract and qpdf versions; npm audit cannot assess vendored WASM. For a vendor update, verify the immutable upstream commit/license and upstream Git blob or signed release, update SHA-256 pins and provenance together, and repeat malformed/signature/action/preservation/cancellation tests. A changed hash is a release blocker until explained and reviewed, not a pin to replace blindly.

A security report should identify the affected release, operation and a synthetic or privately shareable reproduction. Never post confidential PDFs, passwords or form values in a public issue. Use GitHub private vulnerability reporting when enabled; no private contact address is asserted here. Triage active-content execution, remote document transmission and recoverable redaction leaks as release-blocking issues. Publish a reviewed corrective release and its affected-version/mitigation notes; retain the prior exact artifact for rollback review, including data/schema compatibility if applicable.

CI retains a deterministic ZIP, content manifest and archive SHA-256 for the exact build revision and compares repeat builds. These checks prove reproducibility/integrity, not author authenticity or absence of vulnerabilities. Application license status is explicit in LICENSE_STATUS.md; dependency licenses remain separate.
