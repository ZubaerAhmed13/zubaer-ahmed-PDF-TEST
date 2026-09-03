# Release Checklist

Every checked item below is backed by executed repository/build/browser evidence or is a truthful capability boundary explicitly permitted by the original professional-upgrade brief.

## P0 architecture
- [x] Safe migration branch created and used for implementation/certification before production
- [x] Existing monolith/duplicate-entry audit documented
- [x] Previous root application preserved under `legacy/`
- [x] Modular TypeScript/Vite source architecture replaces the production monolith
- [x] Central tool registry powers product discovery/routing
- [x] GitHub Pages nested base path configured
- [x] Dependency lockfile committed; CI installs with `npm ci`
- [x] Full audited legacy feature parity documented in `docs/LEGACY_PARITY_MATRIX.md`
- [x] Obsolete `pdf-all-in-one/index.html` duplicate removed after parity; `legacy/index.html` retained as rollback snapshot

## P1 reliability and PDF handling
- [x] PDF.js worker-enabled active-page preview
- [x] Virtualized/lazy thumbnail rail
- [x] Professional viewer controls: zoom in/out, actual size, fit width, fit page, keyboard navigation, wheel boundary navigation and touch/pen swipe page navigation
- [x] Dedicated worker for core pdf-lib operations
- [x] Dedicated local qpdf 12.3.2 WASM worker for AES-256 protect/unlock
- [x] Meaningful staged progress for migrated long-running operations
- [x] Worker/cooperative cancellation stops active processing
- [x] Recoverable structured errors for invalid/encrypted/unsupported-form input
- [x] Structural Remove/Extract/Rotate/Split/Merge/Organize exports reopened and validated
- [x] Visual organizer with lazy thumbnails, drag reorder, multi-select, duplicate/delete, select-all, undo/redo and deterministic structural export
- [x] Decoded embedded-raster Extract Images workflow certified in Chromium/Firefox/WebKit
- [x] Lightweight IndexedDB project recovery without document-byte persistence
- [x] AcroForm text, checkbox, radio, dropdown and option-list handling, including flattening
- [x] Valid XFA-stream detection reported explicitly as unsupported
- [x] Text and PNG/JPEG image watermark workflows with reopened structural output validation
- [x] Bounded sequential batch queue with malformed-file isolation, cancellation and optional ZIP packaging
- [x] Selective JPEG recompression with Light/Balanced/Strong/Custom controls; certified in Chromium/Firefox/WebKit with >20% embedded-JPEG byte reduction, >10% whole-PDF reduction, preserved page geometry and successful PDF.js rendering on the deterministic image-heavy fixture
- [x] AES-256 Protect PDF, wrong-password rejection, correct Unlock PDF, password non-persistence, reopened geometry validation and no cross-origin processing requests
- [x] OCR capability boundary is truthful: OCR is not advertised and image extraction is not mislabeled as OCR
- [x] Digital-signature terminology boundary is truthful: certificate-based cryptographic signing is not advertised
- [x] Defensive large-document handling: 300-page virtualization/structural processing, 300-DPI scan fixture, workers, transferable buffers, bounded concurrency, file/device-memory warnings, cancellation and cleanup. No unsupported arbitrary multi-gigabyte claim is made
- [x] Output validation for every advertised export-capable operation
- [x] Resource release: worker/canvas cleanup across browsers plus Chromium forced-GC heap-growth bounds

## P2/P3/P4 product, offline, accessibility and compatibility
- [x] Global search and Ctrl/Cmd+K command access
- [x] Favorites/recent tools stored as safe local preferences
- [x] Unified responsive workspace
- [x] Explicit lossless/potentially-lossy/inspection quality labels
- [x] Privacy panel and diagnostics
- [x] Versioned service worker + manifest with nested GitHub Pages scope
- [x] Automated axe serious/critical homepage gate
- [x] Responsive shell/workspace matrix at 360/768/1280 px
- [x] Keyboard dialog focus containment, Escape close and exact trigger focus return
- [x] WCAG-oriented implementation evidence: semantic dialogs/labels/live regions, keyboard tests, responsive tests and axe gate; no external manual WCAG certificate is claimed
- [x] Chromium/Firefox/WebKit automated PDF workflow matrix
- [x] Chromium/Firefox offline reload + worker-backed core processing
- [x] WebKit verification where technically possible: normal worker/qpdf workflows plus forced-offline app/lazy/qpdf cache verification; real Safari forced-offline worker execution is not claimed
- [x] 300-page mixed-dimension page-count/geometry certification
- [x] Three-page A4 2480×3508 JPEG scan fixture (300 DPI) across Chromium/Firefox/WebKit
- [x] Deterministic sRGB raster-export fidelity checks across Chromium/Firefox/WebKit; no blanket ICC/CMYK/print-proof claim
- [x] Production GitHub Pages workflow rebuilds from source and uploads only `dist/`
- [x] Production workflow reruns quality + Chromium + Firefox + WebKit before deployment
- [x] Built artifact deployed successfully to GitHub Pages
- [x] Post-deployment Chromium test against the real Pages URL passed with real Rotate PDF export/reopen and AES-256 Protect PDF export/encryption validation

## Final executed production evidence

GitHub Actions run `33746198800` on commit `61227b471b032e601636b08ffa7dad9fdfcba7b9` completed successfully on 2026-09-03:

- quality: success
- Chromium: success
- Firefox: success
- WebKit: success
- deploy: success
- production live-site verification: success
- npm audit: 0 vulnerabilities reported for the locked npm graph
- unit tests: 31 passed
- production `index.html`: 1.06 kB before gzip
- initial application JS chunk: 17.61 kB, 6.27 kB gzip
- production build: 3.89 s on the recorded GitHub-hosted runner
- generated service worker: 26 precached URLs

Canonical production URL:

`https://zubaerahmed13.github.io/zubaer-ahmed-PDF-TEST/`

# PROFESSIONAL RELEASE READY
