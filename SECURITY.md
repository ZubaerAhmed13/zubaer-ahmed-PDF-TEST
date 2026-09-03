# Security

## Local processing boundary

The migrated application does not configure remote PDF-processing APIs, telemetry, analytics or trackers. Core libraries are bundled as local build dependencies. Migrated PDF and image operations execute in the browser, using dedicated workers where applicable.

## CSP

The root document includes a restrictive CSP:

- default/script/style/connect: same origin
- workers: same origin plus blob
- object embedding: disabled
- base URI: same origin
- forms: disabled
- framing: disabled

The policy must be rechecked against the final production build and PDF.js worker URLs before release.

## File validation

PDF operations validate the `%PDF-` signature in addition to UI file-type filtering. The shared structural loader also forces lazy page-tree traversal so malformed containers that fail after initial parsing are reported through the structured `INVALID_PDF` boundary. Password/encryption signals are mapped separately to `PASSWORD_REQUIRED`.

## Capability boundaries

The current release-candidate branch does **not** implement encrypted-PDF unlock/protect, OCR, or cryptographic digital-signature creation/validation. UI and documentation must not describe visual marks, typed names, ordinary watermarks, metadata inspection, or password detection as those capabilities. A future encryption/OCR/signature engine requires its own dependency, threat-model review, fixtures and executed cross-browser certification.

## Sensitive data

Application logs must not contain document text, passwords or form values. Favorites/recent-tool preferences contain tool identifiers only. Lightweight project recovery may store selected-tool/settings/file metadata in IndexedDB, but document bytes are not intentionally persisted by the recovery layer.

## Dependency gate

`npm audit` is part of CI for the locked dependency graph. Findings must be triaged before release rather than hidden by a marketing status. A successful audit is evidence for the tested dependency graph at that point in time, not a blanket security guarantee.
