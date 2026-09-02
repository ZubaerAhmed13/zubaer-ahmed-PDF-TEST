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
- [ ] Full legacy feature parity demonstrated
- [ ] Obsolete duplicate entry point removed after parity

## P1 reliability
- [x] PDF.js worker-enabled active-page preview
- [x] Dedicated worker for core pdf-lib operations
- [x] Real page/document progress for migrated worker operations
- [x] Worker cancellation terminates processing
- [x] Error categories for invalid/encrypted/unsupported form inputs
- [x] Structural Remove pages and Extract pages with reopen/geometry validation
- [x] Decoded embedded-raster Extract Images workflow certified in Chromium/Firefox/WebKit
- [x] Lightweight IndexedDB project recovery implemented without document-byte persistence
- [ ] Full form field certification across broader field types/XFA fixtures
- [ ] Professional image recompression
- [ ] Encrypted unlock/protect workflows
- [ ] Full thumbnail virtualization
- [ ] Multi-gigabyte streaming/reference architecture
- [ ] Output-reopen validation for every export-capable operation
- [ ] Memory leak certification

## P2/P3/P4
- [x] Search and keyboard command
- [x] Favorites/recent tools stored locally
- [x] Unified responsive workspace
- [x] Explicit quality labels
- [x] Privacy panel and diagnostics
- [x] Service worker/manifest foundation
- [x] Automated axe serious/critical homepage gate
- [x] Automated responsive width matrix at 360/768/1280 px
- [x] Chromium/Firefox/WebKit current automated PDF workflow matrix
- [x] Chromium/Firefox offline reload + worker-backed PDF-operation certification
- [x] WebKit application-shell/chunk precache certification plus normal worker workflow
- [ ] Real Safari/WebKit forced-offline worker-operation manual certification
- [ ] WCAG 2.2 AA manual certification
- [ ] Large PDF/page-count certification
- [ ] Multi-gigabyte file-size certification
- [ ] Color/fidelity certification
- [ ] Production Pages deployment verification

## Release verdict

Do not merge into `main` or label **PROFESSIONAL RELEASE READY** while any critical unchecked P0/P1 item remains.

Current verdict: **NOT YET PROFESSIONAL RELEASE READY**.
