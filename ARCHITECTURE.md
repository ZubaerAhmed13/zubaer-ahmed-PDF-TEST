# Architecture

## Goals

The migration separates product UI, tool metadata, PDF operations, rendering, workers, storage preferences and offline behavior. It deliberately avoids a framework rewrite because the application does not currently need React to achieve modular state boundaries.

## Modules

- `src/app/` — shell, discovery, dialogs and product state.
- `src/tools/registry.ts` — canonical tool definition source for discovery/routing.
- `src/tools/workspace.ts` — unified workspace and operation orchestration.
- `src/pdf/core.ts` — deterministic structural PDF operations.
- `src/pdf/pageRanges.ts` — validated range/order parsing.
- `src/pdf/render.ts` — PDF.js worker-backed active-page rendering and image export.
- `src/pdf/workerClient.ts` — worker lifecycle, progress and cancellation.
- `src/workers/pdf.worker.ts` — heavy pdf-lib/ZIP processing outside the UI thread.
- `public/sw.js` — application-shell/runtime offline cache.
- `legacy/index.html` — recoverable snapshot of the previous root deployment.

## Document model

This phase uses `File` references in the UI and only materializes ArrayBuffers immediately before an operation. Worker operations receive transferable buffers and return transferable output buffers.

This is materially safer than keeping decoded copies in UI state, but it is **not yet sufficient for multi-gigabyte PDFs** because pdf-lib currently requires full in-memory buffers. Large-media certification therefore remains open.

## Preview model

PDF.js uses its worker and renders only the active page canvas. Changing pages cancels the previous render task and calls page cleanup. This avoids the legacy pattern of rendering many full-resolution canvases at once.

Full thumbnail virtualization is still a planned release gate.

## Operation cancellation

Worker-backed operations create one dedicated worker per run. Cancel terminates that worker and rejects the active operation. Main-thread PDF-to-image conversion uses cooperative cancellation between pages.

## Output fidelity

Structural operations (merge, split, reorder, rotate) use PDF page copying/transforms and do not intentionally rasterize. PDF-to-image is explicitly marked potentially lossy. `Optimize PDF` is intentionally labeled limited because the current implementation does not perform professional image recompression.
