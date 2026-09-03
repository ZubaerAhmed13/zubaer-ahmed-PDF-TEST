# Release Checklist

A checkbox is only marked when executed evidence exists. This branch remains a migration/release-candidate branch, not a certified professional release.

## P0 architecture
- [x] Safe migration branch created
- [x] Existing monolith/duplicate-entry audit documented
- [x] Previous root application preserved under `legacy/`
- [x] Modular TypeScript/Vite source architecture added
- [x] Central tool registry added
- [x] GitHub Pages nested base path configured
- [x] Dependency lockfile generated and committed; CI installs with `npm ci`
- [x] Full audited legacy feature parity demonstrated in `docs/LEGACY_PARITY_MATRIX.md`
- [x] Obsolete `pdf-all-in-one/index.html` duplicate entry point removed after parity; `legacy/index.html` remains the rollback snapshot

## P1 reliability
- [x] PDF.js worker-enabled active-page preview
- [x] Virtualized, lazily rendered thumbnail rail sharing the active PDF.js document
- [x] Dedicated worker for core pdf-lib operations
- [x] Dedicated local qpdf 12.3.2 WASM worker for PDF protect/unlock
- [x] Real page/document progress for migrated worker operations
- [x] Worker cancellation terminates processing
- [x] Error categories for invalid/encrypted/unsupported form inputs
- [x] Malformed PDF recovery certified in Chromium/Firefox/WebKit with structured `INVALID_PDF` reporting, including lazy page-tree corruption
- [x] Structural Remove pages and Extract pages with reopen/geometry validation
- [x] Visual Organize pages workflow certified with lazy thumbnails, duplicate, multi-select delete, undo, move controls and deterministic-order compatibility
- [x] Decoded embedded-raster Extract Images workflow certified in Chromium/Firefox/WebKit
- [x] Lightweight IndexedDB project recovery implemented without document-byte persistence
- [x] Supported AcroForm matrix certified for text, checkbox, radio, dropdown and option-list fields, including flattening
- [x] Valid XFA-stream fixture detected and reported explicitly as `UNSUPPORTED_FORM`
- [x] Text watermark structural export remains certified
- [x] PNG/JPEG image watermark workflow implemented with structural PDF export/reopen validation
- [x] Bounded local batch queue certified for sequential processing, per-file outputs, ZIP reopen validation, malformed-file isolation and cancellation
- [ ] Professional image recompression
- [x] Encrypted unlock/protect workflows with AES-256 protect, wrong-password rejection, correct unlock, password non-persistence check and reopened geometry validation
- [ ] OCR/text-layer generation
- [ ] Cryptographic digital-signature creation/validation
- [ ] Multi-gigabyte streaming/reference architecture
- [x] Output validation for every currently migrated export-capable operation (PDF reopen or artifact signature/manifest validation as applicable)
- [ ] Memory leak certification — repeated preview cycles certify worker/canvas cleanup, but heap-growth certification is still required

## P2/P3/P4
- [x] Search and keyboard command
- [x] Favorites/recent tools stored locally
- [x] Unified responsive workspace
- [x] Explicit quality labels
- [x] Privacy panel and diagnostics
- [x] Service worker/manifest foundation
- [x] Automated axe serious/critical homepage gate
- [x] Automated responsive width matrix at 360/768/1280 px
- [x] Automated keyboard dialog focus containment/return for workspace and information dialogs
- [x] Chromium/Firefox/WebKit current automated PDF workflow matrix
- [x] Chromium/Firefox offline reload + worker-backed PDF-operation certification
- [x] WebKit application-shell/chunk precache certification plus normal worker workflow
- [x] Dedicated offline Protect PDF certification in Chromium/Firefox plus WebKit qpdf asset precache verification combined with normal WebKit qpdf execution
- [ ] Real Safari/WebKit forced-offline worker-operation manual certification
- [ ] WCAG 2.2 AA manual certification
- [x] 300-page mixed-dimension structural page-count certification
- [ ] Multi-gigabyte file-size certification
- [x] High-resolution scanned/image-heavy PDF certification using three A4 pages with 2480×3508 JPEG-backed scans (300 DPI), PDF.js preview/navigation, structural rotation, JPEG stream preservation and reopened geometry across Chromium/Firefox/WebKit
- [ ] Color/fidelity certification
- [ ] Production Pages deployment verification

## Release verdict

Do not merge into `main` or label **PROFESSIONAL RELEASE READY** while any critical unchecked P1 item remains.

Current verdict: **NOT YET PROFESSIONAL RELEASE READY**.
