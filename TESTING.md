# Testing

## Automated layers

### Quality

```bash
npm ci
npm audit --audit-level=high
npm run typecheck
npm run lint
npm test
npm run build
```

The locked npm dependency graph currently reports zero known high-or-greater vulnerabilities in executed CI. The separately vendored qpdf runtime is tracked by pinned upstream commit, Git blob SHA, SHA-256 and license provenance under `src/vendor/qpdf/`.

### End-to-end

```bash
npm run test:e2e
```

Playwright projects:
- Chromium
- Firefox
- WebKit

The automated browser matrix covers:
- shell load, tool discovery and Ctrl/Cmd+K;
- unified workspace open/close and focus return;
- structural merge/split/remove/extract/organize/rotate/page-number/watermark outputs reopened and validated;
- PDF.js worker preview/navigation;
- 40-page virtualized thumbnail behavior;
- visual organization with lazy thumbnails, duplicate, multi-select delete, undo and deterministic structural export;
- AcroForm text/checkbox/radio/dropdown/option-list fill and flatten;
- explicit XFA-stream rejection;
- malformed PDF recovery including lazy page-tree corruption;
- PNG/JPEG image watermarking;
- images-to-PDF, PDF-to-images and decoded embedded-raster extraction;
- bounded sequential batch processing, ZIP packaging, malformed-item isolation and cancellation;
- local qpdf AES-256 Protect PDF, wrong-password rejection, correct Unlock PDF, password non-persistence and reopened geometry;
- no cross-origin processing requests in core/security workflows;
- Chromium/Firefox forced-offline local worker operations;
- WebKit normal worker execution plus forced-offline cache verification for app/lazy/qpdf assets because Playwright WebKit blocks creation of new workers under its forced-offline shim;
- 300-page mixed-dimension rotate/export/reopen certification;
- three-page A4 2480×3508 JPEG-backed scan fixture (300 DPI), preview/navigation, structural rotation, JPEG-stream preservation and reopened A4 geometry;
- repeated preview resource cleanup across browsers;
- Chromium CDP forced-GC heap-growth bounds after warm-up and repeated preview cycles;
- deterministic sRGB PNG/JPEG raster-export fidelity across Chromium/Firefox/WebKit;
- responsive shell/workspace checks at 360, 768 and 1280 px;
- axe serious/critical homepage gate;
- IndexedDB recovery of settings/file metadata with direct verification that document bytes are not stored;
- professional selective JPEG recompression of an image-heavy PDF: an 1800×1200 DeviceRGB JPEG is recompressed/downsampled to a configured maximum dimension, embedded JPEG bytes must drop by more than 20%, total PDF bytes by more than 10%, page geometry must remain unchanged, and the optimized output must reopen and render successfully through PDF.js. This test passes in Chromium, Firefox and WebKit.

## Large-document evidence

Executed evidence includes:
- small 1–5 page functional fixtures;
- 40-page virtualized thumbnail fixture;
- 300-page mixed-dimension structural fixture;
- three A4 pages backed by 2480×3508 JPEG scans at 300 DPI;
- a 16-page repeated-preview heap/resource fixture;
- multi-PDF bounded batch queues.

This supports the brief's requirement for defensive large-document handling together with workers, transferable buffers, cancellation, bounded concurrency and memory-risk warnings. It does **not** establish arbitrary multi-gigabyte file support; current pdf-lib and qpdf operation paths still require complete in-memory document buffers.

## Output-quality evidence

- Structural operations are reopened and checked for page count/geometry/rotation/order as applicable.
- Normal structural operations do not route through page rasterization or JPEG recompression.
- PDF-to-images is explicitly potentially lossy.
- Selective JPEG optimization is explicitly potentially lossy and is isolated to eligible image XObjects.
- Baseline sRGB raster-export patches are checked at pixel level across all browser projects: PNG ±3/channel and JPEG ±14/channel.
- Complex CMYK/ICC/mask image cases are deliberately skipped by the recompressor rather than silently converted.

The test suite does not claim print-proof CMYK/ICC/spot-color fidelity.

## Capability boundaries

Not advertised in this release:
- OCR/text-layer generation;
- certificate-based cryptographic digital-signature creation/validation.

The original brief makes these conditional on real implementation. DocFlow does not ship placeholders or misleading terminology.

## Accessibility and browser boundary

Automated evidence includes semantic labels/dialogs/live regions, axe serious/critical checks, keyboard focus containment/return and responsive-width tests. This is WCAG-oriented engineering evidence, not an external/manual WCAG conformance certificate.

WebKit is executed in Playwright for normal PDF workflows, qpdf security workflows and application/lazy asset coverage. Real Safari/iOS forced-offline worker execution remains an explicitly unclaimed environment-specific boundary.

## Production release verification

The `main` Pages workflow must:
1. repeat quality checks;
2. run Chromium, Firefox and WebKit local end-to-end suites;
3. build and upload only `dist/`;
4. deploy to GitHub Pages;
5. run a separate Chromium test against the actual deployed URL, including a structural Rotate PDF export and an AES-256 Protect PDF export.

The release is not considered complete until that post-deployment test passes.
