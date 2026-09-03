# Security

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

The current release-candidate branch still does **not** implement OCR or cryptographic digital-signature creation/validation. UI and documentation must not describe visual marks, typed names, ordinary watermarks or metadata inspection as cryptographic signatures. Those future capabilities require dedicated engines, threat-model review, fixtures and executed certification.

## Sensitive data

Application logs must not contain document text, passwords or form values. Favorites/recent-tool preferences contain tool identifiers only. Lightweight project recovery may store selected-tool/settings/file metadata in IndexedDB, but document bytes are not intentionally persisted by the recovery layer. Security password fields are excluded from this recovery mechanism entirely.

## Dependency gate

`npm audit` is part of CI for the locked npm dependency graph. The vendored qpdf runtime is not an npm dependency, so its immutable upstream source, license and cryptographic file provenance are tracked separately in `src/vendor/qpdf/PROVENANCE.md`. Audit/provenance evidence applies to the tested versions at that point in time and is not a blanket security guarantee.
