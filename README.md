# DocFlow Professional

DocFlow Professional is a local-first browser PDF workspace migrated from the former monolithic deployment to a modular TypeScript/Vite architecture.

## Production status

The professional migration is deployed to GitHub Pages and has passed the guarded production release workflow on the real live URL.

Production release evidence on 2026-09-03 includes:
- quality/build gate: passed;
- Chromium: passed;
- Firefox: passed;
- WebKit: passed;
- built `dist/` Pages deployment: passed;
- post-deployment Chromium verification against the real Pages URL: passed, including a real Rotate PDF download/reopen and a real local AES-256 Protect PDF download/encryption validation.

See `docs/COMPLETION_REPORT.md` for the A–P completion report and `RELEASE_CHECKLIST.md` for the executed release gates.

## Implemented capabilities

- worker-backed PDF.js preview with virtualized thumbnails;
- zoom in/out, actual size, fit-width/fit-page, keyboard/wheel navigation and touch/pen swipe page navigation;
- merge, split, extract/remove pages, organize and rotate without intentional page rasterization;
- visual organizer with drag reorder, multi-select, duplicate/delete, select-all and undo/redo;
- page numbering and text/image watermarking;
- images-to-PDF, PDF-to-images and decoded embedded-raster extraction;
- supported AcroForm inspection/fill/flatten with explicit XFA detection;
- document metadata inspection;
- bounded sequential batch processing;
- local AES-256 Protect/Unlock with pinned qpdf 12.3.2 WebAssembly;
- selective JPEG image recompression with Light/Balanced/Strong/Custom modes;
- local lightweight recovery metadata without persisting PDF/image bytes.

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

The `main` release workflow repeats quality and all three Playwright browser projects before deployment, deploys only the generated `dist/` artifact, then runs a separate Chromium suite against the actual Pages URL.

## Architecture

- TypeScript + Vite
- central tool registry
- lazy-loaded specialized workspaces
- PDF.js worker-backed rendering and bounded thumbnail virtualization
- dedicated module workers for pdf-lib processing
- dedicated qpdf 12.3.2 WASM worker for AES-256 protect/unlock
- worker-side selective JPEG recompression only for explicitly lossy optimization
- deterministic operation inputs/options
- cancellation through worker termination or cooperative cancellation
- bounded batch processing with one active PDF worker at a time
- safe local preferences for favorites/recent tools
- lightweight IndexedDB recovery without PDF/image byte persistence
- versioned PWA/runtime cache under `/zubaer-ahmed-PDF-TEST/`
- no remote PDF-processing API or analytics dependency

See `ARCHITECTURE.md`, `SECURITY.md`, `PRIVACY.md`, `TESTING.md`, `docs/LEGACY_PARITY_MATRIX.md`, `docs/COMPLETION_REPORT.md` and `RELEASE_CHECKLIST.md`.

## Security engine provenance

The encryption runtime is vendored locally from `fayazara/pdfstudio` 0.4.0 at immutable upstream commit `c5c1f2d9f378199d1e2d333dbe4ca20e9ff737ad`, built with qpdf 12.3.2. Integrity metadata, upstream Git blob SHAs, SHA-256 values and Apache-2.0 license provenance are recorded under `src/vendor/qpdf/`.

Passwords used by Protect PDF and Unlock PDF are sent only to the active local qpdf worker. Security workspaces deliberately bypass project recovery so passwords are not persisted in DocFlow IndexedDB recovery state or localStorage.

## Capability boundaries

DocFlow does not advertise OCR or certificate-based cryptographic digital signing. The professional brief requires those capabilities only if they are genuinely implemented; this release therefore keeps those boundaries explicit instead of shipping placeholders or misleading terminology.

Large documents are handled defensively with virtualization, workers, transferable buffers, bounded queues, warnings, cancellation and certified 300-page/high-resolution fixtures. Current pdf-lib and qpdf paths still use complete in-memory document buffers, so this release does **not** claim arbitrary multi-gigabyte PDF processing.

Selective JPEG optimization is intentionally potentially lossy. It targets eligible ordinary RGB JPEG XObjects and leaves complex color/mask cases untouched. Structural operations do not invoke this recompression path.

The sRGB color fixture is a browser raster-export baseline; it is not a blanket CMYK/ICC/spot-color or print-proof certification.

Automated WebKit workflow evidence does not imply real Safari/iOS forced-offline worker certification; that environment-specific limitation remains explicitly unclaimed.

## GitHub Pages

Production URL:

`https://zubaerahmed13.github.io/zubaer-ahmed-PDF-TEST/`

Release pipeline source:

`.github/workflows/pages.yml`

Recorded successful production verification run:

`33746198800`
