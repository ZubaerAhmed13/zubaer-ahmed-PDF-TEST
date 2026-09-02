# Release Checklist

A checkbox is only marked when evidence exists. This branch starts as a migration preview, not a certified release.

## P0 architecture
- [x] Safe migration branch created
- [x] Existing monolith/duplicate-entry audit documented
- [x] Previous root application preserved under `legacy/`
- [x] Modular TypeScript/Vite source architecture added
- [x] Central tool registry added
- [x] GitHub Pages nested base path configured
- [ ] Dependency lockfile generated and committed by CI
- [ ] Full legacy feature parity demonstrated
- [ ] Obsolete duplicate entry point removed after parity

## P1 reliability
- [x] PDF.js worker-enabled active-page preview
- [x] Dedicated worker for core pdf-lib operations
- [x] Real page/document progress for migrated worker operations
- [x] Worker cancellation terminates processing
- [x] Error categories for invalid/encrypted/unsupported form inputs
- [ ] Full form field certification
- [ ] Professional image recompression
- [ ] Encrypted unlock/protect workflows
- [ ] Full thumbnail virtualization
- [ ] Multi-gigabyte streaming/reference architecture
- [ ] Output-reopen validation for every operation
- [ ] Memory leak certification

## P2/P3/P4
- [x] Search and keyboard command
- [x] Favorites/recent tools stored locally
- [x] Unified responsive workspace
- [x] Explicit quality labels
- [x] Privacy panel and diagnostics
- [x] Service worker/manifest foundation
- [ ] WCAG 2.2 AA manual certification
- [ ] axe automation
- [ ] Full responsive width matrix
- [ ] Chromium/Firefox/WebKit full PDF workflow matrix
- [ ] Large PDF certification
- [ ] Color/fidelity certification
- [ ] Offline PDF-operation certification across target browsers
- [ ] Production Pages deployment verification

## Release verdict

Do not merge into `main` or label **PROFESSIONAL RELEASE READY** while any critical unchecked P0/P1 item remains.
