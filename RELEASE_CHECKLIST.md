# Release Checklist

A checkbox is marked only when executed evidence exists or when the original brief defines a truthful capability boundary rather than a mandatory feature. This branch remains a release candidate until the production GitHub Pages deployment is executed and tested.

## P0 architecture
- [x] Safe migration branch created
- [x] Existing monolith/duplicate-entry audit documented
- [x] Previous root application preserved under `legacy/`
- [x] Modular TypeScript/Vite source architecture added
- [x] Central tool registry added
- [x] GitHub Pages nested base path configured
- [x] Dependency lockfile committed; CI installs with `npm ci`
- [x] Full audited legacy feature parity documented in `docs/LEGACY_PARITY_MATRIX.md`
- [x] Obsolete `pdf-all-in-one/index.html` duplicate removed after parity; `legacy/index.html` remains the rollback snapshot

## P1 reliability and PDF handling
- [x] PDF.js worker-enabled active-page preview
- [x] Virtualized/lazy thumbnail rail; large page counts do not create one full-resolution canvas per page
- [x] Dedicated worker for core pdf-lib operations
- [x] Dedicated local qpdf 12.3.2 WASM worker for AES-256 protect/unlock
- [x] Meaningful staged progress for migrated long-running operations
- [x] Worker cancellation terminates active processing
- [x] Recoverable structured errors for invalid/encrypted/unsupported-form input
- [x] Structural Remove pages / Extract pages / Rotate / Split / Merge / Organize exports reopened and validated
- [x] Visual organizer with lazy thumbnails, multi-select, duplicate, delete, undo and deterministic structural export
- [x] Decoded embedded-raster Extract Images workflow certified in Chromium/Firefox/WebKit
- [x] Lightweight IndexedDB project recovery without document-byte persistence
- [x] AcroForm text, checkbox, radio, dropdown and option-list handling, including flattening
- [x] Valid XFA-stream detection reported explicitly as unsupported
- [x] Text and PNG/JPEG image watermark workflows with reopened structural output validation
- [x] Bounded sequential batch queue with malformed-file isolation, cancellation and optional ZIP packaging
- [x] Professional selective JPEG recompression: Light/Balanced/Strong/Custom controls; eligible DeviceRGB JPEG XObjects are recompressed/downsampled in a worker while page/text/vector/form structure remains intact; complex image/color cases are skipped. Certified in Chromium/Firefox/WebKit with >20% embedded-JPEG byte reduction, >10% whole-PDF reduction, preserved page geometry and successful PDF.js rendering on the deterministic fixture
- [x] AES-256 Protect PDF, wrong-password rejection, correct Unlock PDF, password non-persistence, reopened geometry validation and no cross-origin processing requests
- [x] OCR capability boundary is truthful: DocFlow does not advertise OCR. The source brief makes OCR conditional on it being genuinely implemented; image extraction is not mislabeled as OCR
- [x] Digital-signature terminology boundary is truthful: DocFlow does not advertise certificate-based cryptographic signing and does not mislabel visual marks as digital signatures
- [x] Defensive large-document handling required by the brief: 300-page virtualization/structural processing, high-resolution scan fixture, workers, transferable buffers, bounded batch concurrency, file-size/device-memory warnings, cancellation and resource cleanup are certified. No unsupported multi-gigabyte claim is made because current pdf-lib/qpdf paths still require full in-memory buffers
- [x] Output validation for every advertised export-capable operation (PDF reopen or artifact signature/manifest validation as applicable)
- [x] Resource release: worker/canvas cleanup in all browser projects plus Chromium CDP forced-GC heap-growth bounds after warm-up across repeated preview cycles

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
- [x] WCAG-oriented implementation evidence: semantic dialogs/labels/live regions, keyboard focus tests, responsive tests and axe gate. This is not represented as an external/manual WCAG certification
- [x] Chromium/Firefox/WebKit automated PDF workflow matrix
- [x] Chromium/Firefox offline reload + worker-backed core PDF processing
- [x] WebKit verification where technically possible: normal worker-backed PDF/qpdf workflows plus forced-offline app-shell/lazy-chunk/qpdf asset cache verification. Playwright WebKit's forced-offline shim blocks newly created workers, so DocFlow does not claim real Safari forced-offline worker execution
- [x] 300-page mixed-dimension page-count/geometry certification
- [x] Three-page A4 2480×3508 JPEG scan fixture (300 DPI): preview/navigation, structural rotation, JPEG-stream preservation and reopened A4 geometry in Chromium/Firefox/WebKit
- [x] Baseline raster color/fidelity: deterministic sRGB red/green/blue/gray patches through PNG/JPEG export in Chromium/Firefox/WebKit (PNG ±3/channel; JPEG ±14/channel). No blanket ICC/CMYK/print-proof claim
- [ ] Production GitHub Pages deployment from built `dist/` verified by a post-deploy Chromium test against the real Pages URL

## Release policy

The release candidate may merge to `main` only after its branch CI is fully green. The `main` Pages workflow must then repeat quality + Chromium/Firefox/WebKit local tests, deploy only the built `dist/` artifact, and run post-deployment Chromium checks against the actual Pages URL.

Current verdict before that production deployment: **NOT YET PROFESSIONAL RELEASE READY**.
