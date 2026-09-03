# Architecture

## Goals

The migration separates product UI, tool metadata, PDF operations, rendering, workers, storage preferences/recovery and offline behavior. It deliberately avoids a framework rewrite because the application does not currently need React to achieve modular state boundaries.

## Modules

- `src/app/` — shell, discovery, dialogs and product state.
- `src/app/projectStore.ts` — IndexedDB persistence for lightweight project recovery. It stores tool/settings/file metadata only, never document bytes.
- `src/tools/registry.ts` — canonical tool definition source for discovery/routing.
- `src/tools/workspace.ts` — unified workspace and operation orchestration.
- `src/tools/workspaceWithRecovery.ts` — generic workspace wrapper that restores settings and file metadata while requiring file reselection.
- `src/tools/organizeWorkspace.ts` — visual page organization with lazy thumbnails, multi-select, duplicate/delete, move controls and undo/redo.
- `src/tools/extractImagesWorkspace.ts` — PDF.js decoded embedded-raster extraction with PNG/ZIP packaging; it does not render whole pages or claim preservation of original compressed image streams.
- `src/tools/encryptionWorkspace.ts` — local AES-256 Protect/Unlock workspace that deliberately bypasses recovery so passwords are not persisted.
- `src/pdf/core.ts` — deterministic structural PDF operations.
- `src/pdf/pageRanges.ts` — validated range/order parsing.
- `src/pdf/render.ts` — PDF.js worker-backed active-page rendering and page-image export.
- `src/pdf/workerClient.ts` — pdf-lib worker lifecycle, progress and cancellation.
- `src/pdf/qpdfWorkerClient.ts` — qpdf worker lifecycle, progress and cancellation.
- `src/workers/pdf.worker.ts` — heavy pdf-lib/ZIP processing outside the UI thread.
- `src/workers/qpdf.worker.ts` — pinned local qpdf 12.3.2 WebAssembly execution for encryption/decryption.
- `scripts/generate-sw.mjs` — deterministic production service-worker/precache generation after the Vite build.
- `legacy/index.html` — recoverable snapshot of the previous root deployment.

## Document model

Generic workspaces keep `File` references in UI state and only materialize ArrayBuffers immediately before an operation. Worker operations receive transferable buffers and return transferable output buffers. Lightweight recovery stores metadata only, so document bytes are not duplicated into IndexedDB.

This is materially safer than keeping decoded copies in UI state, but it is **not yet sufficient for multi-gigabyte PDFs** because current pdf-lib and qpdf worker paths still materialize complete input/output buffers for processing. Multi-gigabyte streaming/reference architecture and real large-file certification therefore remain open and must not be inferred from the 300-page or 300-DPI fixture results.

## Project recovery model

Generic tool workspaces persist one lightweight recovery snapshot in IndexedDB. The snapshot contains the selected tool ID, option values, timestamp and file metadata (`name`, `size`, `type`, `lastModified`). PDF/image bytes are intentionally excluded. After a reload, settings and metadata can be restored, but the user must reselect the original file before processing continues.

Security workspaces for Protect PDF and Unlock PDF deliberately do not use this recovery wrapper. Password values exist only in the active UI/worker lifetime and are cleared after completion, failure, cancellation or workspace cleanup.

## Preview model

PDF.js uses its worker and renders only the active page canvas. Changing pages cancels the previous render task and calls page cleanup. The thumbnail rail is virtualized: only an overscanned visible page window exists in the DOM and thumbnails are rendered lazily. This avoids the legacy pattern of rendering a full-resolution canvas for every page.

Automated evidence includes a 40-page thumbnail-virtualization flow, a 300-page mixed-dimension structural workflow, and a three-page A4 300-DPI scan-style fixture backed by 2480×3508 JPEG images.

## Embedded image extraction

`Extract images` inspects PDF.js page operator lists and resolves supported embedded raster image objects. Decoded pixels are exported as PNG files in a ZIP with a manifest. Vector artwork, image masks and page screenshots are not mislabeled as extracted embedded images. Because extraction uses decoded pixel data, DocFlow does not claim preservation of the original JPEG/JPX/compressed image-stream bytes or source metadata.

## Operation cancellation

Worker-backed operations create one dedicated worker per run. Cancel terminates that worker and rejects the active operation. Main-thread PDF-to-image and embedded-image workflows use cooperative cancellation between pages/objects.

## Output fidelity

Structural operations (merge, split, remove/extract pages, reorder, rotate) use PDF page copying/transforms and do not intentionally rasterize. The 300-DPI scan certification additionally verifies that structural rotation preserves JPEG `/DCTDecode` image streams while the reopened PDF retains expected page geometry. PDF-to-image is explicitly marked potentially lossy. Embedded-image extraction converts supported decoded raster data to PNG and is not described as byte-preserving. `Optimize PDF` is intentionally labeled Limited because the current implementation performs structural optimization rather than professional image recompression.

## Legacy parity and duplicate entry point

`docs/LEGACY_PARITY_MATRIX.md` maps the audited legacy capabilities to the modular implementation and executed evidence. Once that parity record is committed, the obsolete `pdf-all-in-one/index.html` duplicate entry point is removed from the migration branch. `legacy/index.html` remains the explicit historical rollback snapshot.

## Offline certification boundary

Chromium and Firefox automated tests certify an offline reload followed by local worker-backed core PDF processing and a separate real offline qpdf AES-256 Protect PDF operation. Playwright WebKit 26.5 intercepts newly created workers after `context.setOffline(true)` before the service worker can answer, so the automated WebKit gate verifies the application shell, encryption workspace chunk, qpdf worker and qpdf WASM are precached while offline and separately verifies normal WebKit worker-backed PDF/qpdf workflows. Real Safari/iOS forced-offline worker execution remains a manual release gate; the harness limitation is not presented as product certification.
