# DocFlow Professional

DocFlow is a local-first browser PDF workspace. The `professional-upgrade` branch is a safe migration from the previous monolithic deployment to a modular TypeScript/Vite architecture.

## Current migration status

This branch is **not yet a production release**. The current migrated set includes structural PDF editing, worker-backed preview with virtualized thumbnails, supported AcroForm editing/flattening, text and image watermarking, image conversion/extraction, metadata inspection, and a bounded sequential batch queue. Professional image recompression, encrypted unlock/protect workflows, multi-gigabyte architecture/certification, remaining legacy parity, manual accessibility/Safari validation and production deployment verification remain release gates.

The previous root application is preserved at `legacy/index.html` on the migration branch and remains recoverable from git history. Production `main` should not be replaced until `RELEASE_CHECKLIST.md` is satisfied.

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
- deterministic operation inputs/options
- cancellable worker operations by worker termination
- bounded batch processing with one active PDF worker at a time
- local preferences only for favorites/recent tools
- lightweight IndexedDB recovery without document-byte persistence
- PWA runtime/precache support with nested GitHub Pages scope
- no remote PDF-processing API or analytics dependency

See `ARCHITECTURE.md`, `SECURITY.md`, `PRIVACY.md`, `TESTING.md` and `RELEASE_CHECKLIST.md`.

## Capability boundaries

DocFlow does not currently claim OCR, cryptographic digital-signature creation/validation, encrypted PDF unlock/protect, or professional image recompression. Those capabilities require dedicated engines and their own executed release evidence before they can be marketed as supported.

## GitHub Pages

Vite base path is explicitly configured for:

`/zubaer-ahmed-PDF-TEST/`

The canonical production URL remains:

`https://zubaerahmed13.github.io/zubaer-ahmed-PDF-TEST/`
