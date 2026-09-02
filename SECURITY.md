# Security

## Local processing boundary

The migrated application does not configure remote PDF-processing APIs, telemetry, analytics or trackers. Core libraries are bundled as local build dependencies.

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

PDF operations validate the `%PDF-` signature in addition to UI file-type filtering. Parsing failures and password/encryption signals are mapped to user-facing error categories.

## Sensitive data

Application logs must not contain document text, passwords or form values. Preferences stored locally are limited to UI settings such as favorites/recent tools.

## Dependency gate

`npm audit --audit-level=high` is part of CI. High/critical findings must be triaged before release rather than hidden by a marketing status.
