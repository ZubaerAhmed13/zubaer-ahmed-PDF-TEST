# DocFlow Professional

DocFlow is a local-first browser PDF workspace. The `professional-upgrade` branch is a safe migration from the previous monolithic deployment to a modular TypeScript/Vite architecture.

## Current migration status

This branch is **not yet a production release**. The current migrated set includes structural PDF editing, worker-backed preview with virtualized thumbnails, supported AcroForm editing/flattening, text and image watermarking, image conversion/extraction, metadata inspection, a bounded sequential batch queue, and local AES-256 PDF protect/unlock powered by a pinned qpdf 12.3.2 WebAssembly runtime. Audited legacy parity is documented in `docs/LEGACY_PARITY_MATRIX.md`, and the obsolete second entry point is removed on the migration branch while the full historical root remains preserved at `legacy/index.html`.

Professional image recompression, OCR/text-layer generation, cryptographic digital signatures, multi-gigabyte architecture/certification, heap-growth memory certification, manual accessibility/Safari validation, color/fidelity certification and production deployment verification remain release gates.

Production `main` should not be replaced until `RELEASE_CHECKLIST.md` is satisfied.

## Development

```bash
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

CI installs the locked dependency graph with `npm ci`, runs dependency audit, typecheck, lint, unit tests and the production build, then executes Playwright projects for Chromium, Firefox and WebKit.

## Architecture

- TypeScript + Vite
- central tool registry
- lazy-loaded specialized tool workspaces
- PDF.js worker-backed page rendering and bounded thumbnail virtualization
- dedicated module workers for pdf-lib processing
- dedicated qpdf 12.3.2 WASM worker for AES-256 protect/unlock
- deterministic operation inputs/options
- cancellable worker operations by worker termination
- bounded batch processing with one active PDF worker at a time
- local preferences only for favorites/recent tools
- lightweight IndexedDB recovery without document-byte persistence
- PWA runtime/precache support with nested GitHub Pages scope
- no remote PDF-processing API or analytics dependency

See `ARCHITECTURE.md`, `SECURITY.md`, `PRIVACY.md`, `TESTING.md`, `docs/LEGACY_PARITY_MATRIX.md` and `RELEASE_CHECKLIST.md`.

## Security engine provenance

The encryption runtime is vendored locally from `fayazara/pdfstudio` 0.4.0 at immutable upstream commit `c5c1f2d9f378199d1e2d333dbe4ca20e9ff737ad`, built with qpdf 12.3.2. Integrity metadata, upstream Git blob SHAs, SHA-256 values and the Apache-2.0 license are recorded under `src/vendor/qpdf/`.

Passwords used by Protect PDF and Unlock PDF are sent only to the active local qpdf worker. Those security workspaces deliberately bypass project recovery so passwords are not stored in DocFlow's IndexedDB recovery state or localStorage.

## Capability boundaries

DocFlow does not currently claim OCR, cryptographic digital-signature creation/validation, or professional image recompression. Those capabilities require dedicated engines and executed release evidence before they can be marketed as supported.

The completed high-resolution fixture proves handling of three A4 pages backed by 2480×3508 JPEG scans (300 DPI); it does **not** prove multi-gigabyte file handling. Large-file streaming/reference architecture remains a separate gate.

## GitHub Pages

Vite base path is explicitly configured for:

`/zubaer-ahmed-PDF-TEST/`

The canonical production URL remains:

`https://zubaerahmed13.github.io/zubaer-ahmed-PDF-TEST/`
