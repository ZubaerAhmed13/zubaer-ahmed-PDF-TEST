# Architecture

## Goals

The migration separates product UI, tool metadata, PDF operations, rendering, workers, storage preferences/recovery and offline behavior. It deliberately avoids a framework rewrite because the application does not currently need React to achieve modular state boundaries.

## Modules

- `src/app/` — shell, discovery, dialogs and product state.
- `src/app/projectStore.ts` — IndexedDB persistence for lightweight project recovery. It stores tool/settings/file metadata only, never document bytes.
- `src/tools/registry.ts` — canonical tool definition source for discovery/routing.
- `src/tools/workspace.ts` — unified workspace and operation orchestration.
- `src/tools/workspaceWithRecovery.ts` — generic workspace wrapper that restores settings and file metadata while requiring file reselection.
- `src/tools/extractImagesWorkspace.ts` — PDF.js decoded embedded-raster extraction with PNG/ZIP packaging; it does not render whole pages or claim preservation of original compressed image streams.
- `src/pdf/core.ts` — deterministic structural PDF operations.
- `src/pdf/pageRanges.ts` — validated range/order parsing.
- `src/pdf/render.ts` — PDF.js worker-backed active-page rendering and page-image export.
- `src/pdf/workerClient.ts` — worker lifecycle, progress and cancellation.
- `src/workers/pdf.worker.ts` — heavy pdf-lib/ZIP processing outside the UI thread.
- `public/sw.js` — application-shell/runtime offline cache.
- `legacy/index.html` — recoverable snapshot of the previous root deployment.

## Document model

Generic workspaces keep `File` references in UI state and only materialize ArrayBuffers immediately before an operation. Worker operations receive transferable buffers and return transferable output buffers.

This is materially safer than keeping decoded copies in UI state, but it is **not yet sufficient for multi-gigabyte PDFs** because current pdf-lib operations require full in-memory buffers. Multi-gigabyte streaming/reference architecture and large-media certification therefore remain open.

## Project recovery model

Generic tool workspaces persist one lightweight recovery snapshot in IndexedDB. The snapshot contains the selected tool ID, option values, timestamp and file metadata (`name`, `size`, `type`, `lastModified`). PDF/image bytes are intentionally excluded. After a reload, settings and metadata can be restored, but the user must reselect the original file before processing continues.

## Preview model

PDF.js uses its worker and renders only the active page canvas. Changing pages cancels the previous render task and calls page cleanup. This avoids the legacy pattern of rendering many full-resolution canvases at once.

Full thumbnail virtualization is still a planned release gate.

## Embedded image extraction

`Extract images` inspects PDF.js page operator lists and resolves supported embedded raster image objects. Decoded pixels are exported as PNG files in a ZIP with a manifest. Vector artwork, image masks and page screenshots are not mislabeled as extracted embedded images. Because extraction uses decoded pixel data, DocFlow does not claim preservation of the original JPEG/JPX/compressed image-stream bytes or source metadata.

## Operation cancellation

Worker-backed operations create one dedicated worker per run. Cancel terminates that worker and rejects the active operation. Main-thread PDF-to-image and embedded-image workflows use cooperative cancellation between pages/objects.

## Output fidelity

Structural operations (merge, split, remove/extract pages, reorder, rotate) use PDF page copying/transforms and do not intentionally rasterize. PDF-to-image is explicitly marked potentially lossy. Embedded-image extraction converts supported decoded raster data to PNG and is not described as byte-preserving. `Optimize PDF` is intentionally labeled limited because the current implementation does not perform professional image recompression.

## Offline certification boundary

Chromium and Firefox automated tests certify an offline reload followed by a local worker-backed PDF operation. Playwright WebKit 26.5 intercepts worker/network creation after `context.setOffline(true)` before the service worker can answer, so the automated WebKit gate instead verifies the application shell/chunks are precached while offline and separately verifies the normal WebKit worker-backed PDF workflow. Real Safari/WebKit offline worker execution remains a manual release gate; the limitation is not presented as product certification.
