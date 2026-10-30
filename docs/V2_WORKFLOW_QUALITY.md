# DocFlow 2.0 workflow quality

20 October 2026. Improvement slice on the draft v2 branch, based on `c6648fbc39809d97a078d383dc4950589a15e671`.

## What changed

The document journey keeps its files, additions, undo/redo history, page order and safe settings when returning from a result or using browser Back/Forward. Search opens over the document. Destructive resets, source replacement and tool changes require an explicit choice. Processing can be cancelled; late asynchronous results cannot take over a newer session. Changes to source order, page selection or edits invalidate the previous download, and recovered routes use the correct work URL.

Added text uses the export font's glyph outlines and advances at PDF-point size, including explicit line breaks. Overflow and unsupported glyphs are flagged. This improves additions preview fidelity; it does not add original-content editing.

The organiser displays actual PDF page thumbnails in the main document area. Drag, move, duplicate, remove, undo and redo feed the existing structural PDF worker. Previewing a page has an explicit return to the grid. Render queues and retained canvases are bounded.

Phone zoom changes the displayed page dimensions and permits scrolling to the edges. Fit width/page controls, shorter landscape layouts, an Options close button, Escape and focus restoration make the workspace easier to use. The homepage has compact popular-tool shortcuts and stable category colours.

Compression exposes presets and advanced JPEG quality (50–95%) and maximum image dimension (900–5000 pixels). These map to actual worker options. Results show measured input/output bytes and eligible/recompressed image counts. A no-reduction result explains the outcome and offers the original. The pixel ceiling is not labelled DPI. Existing processing warnings are visible beside downloads.

## Review corrections

Fresh review reproduced and prompted regression coverage for:

- A stale download after file reorder/removal or thumbnail selection and browser Forward.
- Lost option values when file order remounted the workspace.
- Retained page-selection values without retained pressed-state indicators.
- Text typed into a focused property field being lost on browser navigation before a change event. Disposal now commits pending properties to the shared history.

## Verification

- Typecheck, ESLint and production build passed. Existing large-bundle and qpdf browser-externalisation build warnings remain.
- All **145 unit tests across 30 files passed** with `npm test -- --maxWorkers=1 --testTimeout=20000`. The runtime flags avoid resource-related 5-second rendering timeouts seen under parallel load; no assertions were weakened.
- All **32 v2 Chromium browser tests passed** against the production build, using the existing Playwright configuration with a container-compatible Chromium executable and a preview-only server override. The full v2 suite is `npx playwright test e2e/v2-*.spec.ts --project=chromium` with Playwright's standard browser installation.
- Downloaded organiser pages had widths `[540,500,520]` after dragging page 3 first. Reordering source files after returning from results produced `[610,500,520,540]`; browser Forward did not expose the stale file.
- A real 1800×1200 JPEG XObject became 1000 pixels wide with custom quality 65%, the output was below 90% of original bytes, and the original selectable text remained extractable.
- Images-to-PDF retained US Letter portrait and margin settings after source reordering and exported real 612×792-point pages.
- Passwords were empty on returning to editing after an AES-256 protect export; the exported file independently round-tripped through the real unlock worker.
- Visual inspection covered desktop home/work/results, the 390×844 phone home/work/options, added-text sizing and the organiser. The 844×390 landscape test verifies Run stays in the viewport. The fresh review also checked that the zoomed page's left edge stays reachable.

Browser tests inspect downloaded PDF bytes, text and image objects as well as interface state. The 13 new workflow-quality cases are included in the existing Chromium/Firefox/WebKit CI matrix. Local verification used Chromium; Firefox and WebKit results must be checked on the new commit before release. Full legacy tests target the retired interface and remain a separate parity migration.

## Remaining release work

This remains the 22-adapter v2 migration preview. The seven unconnected tools and full legacy parity are tracked in the existing master plan and issue #37. Physical iOS/Android devices and full assistive-technology acceptance remain release checks; desktop Chromium with phone viewport emulation is not equivalent to those checks.

Original PDF text/image replacement needs an object-aware engine, source font/encoding handling and corpus verification. The current editor adds content and annotations and says so. See [the engine evaluation and acceptance contract](V2_NATIVE_EDITING_ENGINE_EVALUATION.md). The next technical step is a PDFium or supported commercial SDK prototype that replaces real source objects, saves, independently reopens and passes representative difficult documents. No white-cover or rasterisation substitute is accepted.

Compression currently rewrites structure and selectively recompresses eligible RGB JPEG XObjects. Other encodings, masks and unsupported image cases remain unchanged. Broader image processing, real Office conversion, server OCR and secure hosted jobs remain backend work in issue #38. A hosted integration and benchmark are required before making those capabilities available.

The draft branch must not be merged or publicly deployed merely because its isolated v2 tests pass.
