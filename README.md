# DocFlow Professional

DocFlow Professional is a local-first browser PDF workspace migrated from the former monolithic deployment to a modular TypeScript/Vite architecture.

## Release-candidate status

The `professional-upgrade` branch now has audited legacy parity and automated evidence across Chromium, Firefox and WebKit for the advertised PDF workflows. The historical root remains preserved at `legacy/index.html`; the obsolete duplicate `pdf-all-in-one` entry point has been removed.

Implemented capabilities include:
- worker-backed PDF.js preview with virtualized thumbnails;
- merge, split, extract/remove pages, organize and rotate without intentional page rasterization;
- page numbering and text/image watermarking;
- images-to-PDF, PDF-to-images and decoded embedded-raster extraction;
- supported AcroForm inspection/fill/flatten with explicit XFA detection;
- document metadata inspection;
- bounded sequential batch processing;
- local AES-256 Protect/Unlock with pinned qpdf 12.3.2 WebAssembly;
- professional selective JPEG image recompression with Light/Balanced/Strong/Custom modes.

Automated evidence also covers a 300-page mixed-dimension workflow, A4 300-DPI JPEG-backed scans, deterministic resource cleanup, Chromium forced-GC heap-growth bounds, sRGB PNG/JPEG raster-export fidelity and professional image-recompression size/geometry/renderability checks.

The final remaining release gate is production GitHub Pages deployment from the built `dist/` artifact followed by a real post-deployment browser workflow against the canonical URL.

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

The release workflow on `main` repeats quality and all three Playwright browser projects before deployment, deploys only `dist/`, then runs a separate Chromium suite against the real Pages URL.

## Architecture

- TypeScript + Vite
- central tool registry
- lazy-loaded specialized workspaces
- PDF.js worker-backed rendering and bounded thumbnail virtualization
- dedicated module workers for pdf-lib processing
- dedicated qpdf 12.3.2 WASM worker for AES-256 protect/unlock
- worker-side selective JPEG recompression using decoded image bitmaps/canvas only for explicitly lossy optimization
- deterministic operation inputs/options
- cancellation through worker termination or cooperative cancellation
- bounded batch processing with one active PDF worker at a time
- safe local preferences for favorites/recent tools
- lightweight IndexedDB recovery without PDF/image byte persistence
- versioned PWA runtime/precache support under `/zubaer-ahmed-PDF-TEST/`
- no remote PDF-processing API or analytics dependency

See `ARCHITECTURE.md`, `SECURITY.md`, `PRIVACY.md`, `TESTING.md`, `docs/LEGACY_PARITY_MATRIX.md` and `RELEASE_CHECKLIST.md`.

## Security engine provenance

The encryption runtime is vendored locally from `fayazara/pdfstudio` 0.4.0 at immutable upstream commit `c5c1f2d9f378199d1e2d333dbe4ca20e9ff737ad`, built with qpdf 12.3.2. Integrity metadata, upstream Git blob SHAs, SHA-256 values and Apache-2.0 license provenance are recorded under `src/vendor/qpdf/`.

Passwords used by Protect PDF and Unlock PDF are sent only to the active local qpdf worker. Those security workspaces deliberately bypass project recovery so passwords are not persisted in DocFlow IndexedDB recovery state or localStorage.

## Capability boundaries

DocFlow does not advertise OCR or certificate-based cryptographic digital signing. The original upgrade brief requires those capabilities only if they are genuinely implemented; DocFlow therefore keeps the boundary explicit instead of shipping placeholders or misleading terminology.

Large documents are handled defensively with virtualization, workers, transferable buffers, bounded queues, warnings, cancellation and certified 300-page/high-resolution fixtures. Current pdf-lib and qpdf paths still use full in-memory document buffers, so this release does **not** claim arbitrary multi-gigabyte PDF processing.

The selective JPEG optimizer is intentionally potentially lossy. It targets eligible ordinary RGB JPEG XObjects and leaves complex color/mask cases untouched. Structural operations do not route normal PDFs through this recompression path.

The sRGB color fixture is a browser raster-export baseline; it is not a blanket CMYK/ICC/spot-color or print-proof certification.

## GitHub Pages

Vite is configured for:

`/zubaer-ahmed-PDF-TEST/`

Canonical production URL:

`https://zubaerahmed13.github.io/zubaer-ahmed-PDF-TEST/`
