# Architecture

## Goals

DocFlow Professional separates product UI, tool metadata, document operations, rendering, workers, local recovery, security runtime and offline behavior into maintainable modules. The migration deliberately uses TypeScript/Vite without adding a framework that the product does not need.

## Modules

- `src/app/` — application shell, discovery, dialogs and safe product state.
- `src/app/projectStore.ts` — IndexedDB persistence for lightweight recovery metadata/options only; document bytes are never persisted.
- `src/tools/registry.ts` — canonical tool-definition source for homepage/search/favorites/recent/routing.
- `src/tools/workspace.ts` — unified workspace and generic operation orchestration.
- `src/tools/workspaceWithRecovery.ts` — generic workspace wrapper restoring settings/file metadata while requiring file reselection.
- `src/tools/organizeWorkspace.ts` — visual page organization with lazy thumbnails and deterministic structural export plan.
- `src/tools/compressionWorkspace.ts` — explicit potentially-lossy JPEG optimization controls.
- `src/tools/encryptionWorkspace.ts` — password-handling boundary for local qpdf protect/unlock; no project-state persistence.
- `src/tools/extractImagesWorkspace.ts` — decoded embedded-raster extraction without whole-page screenshots.
- `src/pdf/core.ts` — deterministic structural pdf-lib operations.
- `src/pdf/imageRecompression.ts` — selective worker-side RGB JPEG XObject recompression.
- `src/pdf/render.ts` — PDF.js worker-backed active-page rendering and raster export.
- `src/pdf/workerClient.ts` — worker lifecycle, progress and cancellation.
- `src/workers/pdf.worker.ts` — heavy pdf-lib and compression operations off the UI thread.
- `src/workers/qpdf.worker.ts` — pinned qpdf 12.3.2 WASM AES-256 protect/unlock runtime.
- `public/sw.js` + generated precache manifest — versioned offline application shell/runtime cache.
- `legacy/index.html` — recoverable snapshot of the previous root deployment.

## Document model and memory boundary

Generic workspaces keep browser `File` references in UI state and materialize ArrayBuffers only immediately before an operation. Worker operations receive transferable buffers and return transferable output buffers. Bounded batch processing runs one PDF worker at a time.

The UI estimates risk from source size and `navigator.deviceMemory` where available and warns before potentially expensive in-memory operations. Current pdf-lib and qpdf paths still require complete document buffers; therefore DocFlow does not claim arbitrary multi-gigabyte PDFs or pretend that MEMFS is a streaming file system. The release instead certifies the defensive behaviors actually required by the brief: virtualization, workers, transfers, warnings, cancellation, bounded concurrency, cleanup, 300-page processing and high-resolution scan handling.

## Preview model

PDF.js uses its own worker and renders one full active-page canvas. Thumbnail rendering is virtualized to a small overscanned window. Changing pages cancels obsolete rendering; page cleanup is called after render tasks and the document/worker is destroyed when the workspace closes.

## Structural output policy

Merge, split, remove/extract, organize and rotate copy or transform PDF page structures and do not intentionally rasterize pages. Page numbering and watermarking add content to the existing PDF rather than rendering the source pages to images.

Preview resolution never determines final structural export quality.

## Professional image optimization

`Optimize PDF` is explicitly potentially lossy. It enumerates indirect PDF image streams and only considers conservative ordinary `/Subtype /Image`, `/Filter /DCTDecode`, `/DeviceRGB`, 8-bit JPEG XObjects without masks/complex color metadata. Eligible JPEGs are decoded in the worker, downsampled/re-encoded according to Light/Balanced/Strong/Custom settings, and replaced at the same PDF object reference only when the encoded replacement is smaller.

Text, vectors, forms, page geometry and unrelated objects remain structural. Complex CMYK/ICC/mask cases are skipped rather than silently color-converted. Normal structural tools never invoke this recompression path.

## Embedded image extraction

`Extract images` inspects PDF.js operator lists and resolves supported embedded raster image objects. Decoded pixels are exported to PNG/ZIP with a manifest. Vector artwork, image masks and page screenshots are not mislabeled as extracted embedded images. The feature does not claim preservation of original JPEG/JPX stream bytes or source metadata.

## Operation cancellation

Worker-backed operations create a dedicated worker per run; Cancel terminates that worker. Main-thread PDF.js raster/export paths use cooperative cancellation between pages/objects. Closing the workspace terminates active work and revokes generated object URLs.

## Recovery model

One lightweight recovery snapshot stores tool ID, option values, timestamp and file metadata (`name`, `size`, `type`, `lastModified`). Document/image contents and security passwords are excluded. On reload, settings can be restored but the original files must be reselected.

## Security model

AES-256 Protect/Unlock uses a pinned local qpdf 12.3.2 WASM runtime in its own worker. Password fields are cleared after operations and the security workspace bypasses IndexedDB recovery. No remote PDF-processing service is configured.

## Offline and deployment boundary

The generated service-worker precache includes application assets and lazy runtime chunks under the GitHub Pages base `/zubaer-ahmed-PDF-TEST/`. Chromium and Firefox execute real worker-backed operations after a forced-offline reload. Playwright WebKit blocks creation of new workers after its forced-offline shim is enabled, so automated WebKit evidence combines genuine offline cache inspection for the exact lazy/qpdf assets with separately executed normal WebKit worker workflows. This is accurately reported and is not presented as real Safari forced-offline worker certification.

The final `main` release workflow builds `dist/`, repeats quality and Chromium/Firefox/WebKit local suites before deployment, uploads only `dist/`, deploys to Pages and then runs a separate Chromium suite against the real deployed URL.
