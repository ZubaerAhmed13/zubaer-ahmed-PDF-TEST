# U4 — visual Remove pages and Extract pages

19 October 2026 · Builds on U3 visual page editor

## Problem addressed
Remove pages and Extract pages previously required a manual 1-based page expression. Users could preview the document but had no direct visual mapping from a selected thumbnail to the worker's range field. The user supplied iLovePDF examples specifically showing a grid with crosses for removed pages and a side control area.

## Delivered
- Existing `remove-pages` and `extract-pages` tools now load a shared, separate UI adapter. All PDF bytes continue to be processed by the established PDF worker, not a new converter.
- A page thumbnail grid in the **central workspace**, not an overly narrow settings panel. The original PDF source preview remains accessible via Overview.
- Individual selection, Shift-click additive ranges, Select all and Clear, plus an enlarged, locally rendered PDF preview.
- Selected pages are visually marked with a red remove symbol or purple extract check. The `name="pages"` field in Settings remains the processing source of truth, synchronising both directions.
- Strict 1-based range checking (including manual edits), clear selection count, guard against removing every page and no hidden changes to the file.
- Bounded bitmap cache, lazy rendering with IntersectionObserver, per-workspace PDF controller teardown, generation guards, preserved original files and focus recovery from the modal.
- Responsive touch-friendly buttons; no mandatory drag gestures.
- Test cases exercise exact output page widths after selecting ranges, manual page-range synchronisation, and mobile preview.

## Non-goals
- No Office conversion, AI backends, PDF/A, global editor rewrite or cloud change.
- No OCR for choosing page text; thumbnails can show scanned and native pages alike.
- No false claim of a validated two-times faster UX until same-task user studies have been completed.

## Acceptance
- Four-page source → clicking pages 1 and Shift-clicking 3 maps to `1-3`; Remove exports page 4 only.
- Entering `4,2` for Extract selects cards 2 and 4; clicking page 1 updates `1-2,4` and exports exactly pages 1,2,4.
- Selecting all for Remove informs the user that at least one page must stay; no empty export.
- The enlarged preview allows reading the source, closes with a pointer or keyboard and restores focus to the originating Preview button.
- All work remains entirely local. File change/removal, cancellation, multi-tool session and repeated mounting dispose render resources.
- Typecheck, lint, build, unit tests and Playwright in Chromium/Firefox/WebKit before merge.
- Physical iOS/Android device testing still required for product-quality sign-off.

## Follow-on (not in U4)
1. **Merge PDF**: full-size document thumbnails, robust reorder handles and zoom, plus keyboard reordering without dragging.
2. **Split PDF**: preview-driven output ranges, with separate batches clearly previewed before export.
3. Page card design consolidation across Organize/Remove/Extract/Merge/Split and performance validation for 200+ pages.
