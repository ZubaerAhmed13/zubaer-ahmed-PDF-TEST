# U5 — Merge PDF visual storyboard

Goal: match the simplicity of iLovePDF's visual merge controls without duplicating or breaking the real PDF engine.

## Implemented
- Files appear as a horizontally scrollable storyboard in the document workspace, before the existing zoomable source preview.
- A first-page thumbnail is rendered locally from each PDF using the already-installed PDF.js infrastructure. A single queued task at a time avoids simultaneous heavy PDF loading. Only 24 canvas previews remain retained; more are rendered lazily, with eviction and re-rendering as cards enter the viewport.
- Position numbers describe the actual order of input files in the worker. Drag handles reorder files; Move left / Move right are usable without drag-and-drop, including on touch devices.
- Preview sends the selected file into the existing PDF reader. Remove delegates to the existing real file row. Add files still uses the native chooser.
- File reordering calls the existing authoritative file-list rebuild in `legacyScreenshotParity`, not a fake visual sort. The processing engine receives the new order.
- Output filename editing, bulk page counts, privacy, result/download and session handling remain unchanged.

## Acceptance and safeguards
- Two PDFs with distinct page widths, reordered via buttons or drag, export in corresponding byte-verified order.
- Pre-edit reader remains present and zoomable.
- Mobile 390px viewport has no horizontal page overflow and supports file reordering.
- No server dependencies, analytics, uploads, or unsafe HTML from unsanitised filenames.
- Preview queues and observers disposed when leaving tool; stale asynchronous results ignored.
- Run TypeScript, lint, unit tests, production build, all Playwright engines before merge.
- Physically verify Safari and Android and benchmark large PDFs before calling the experience fully polished.

## Not included
- Editing arbitrary pages *between* files in Merge. That requires a separate structural interleave feature and a compatible PDF operation plan rather than pretending file-level reorder is page-level reorder.
- Split PDF visual output ranges (next release after U5 acceptance).
