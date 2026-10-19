# U3 — visual page workspace

Date: 19 October 2026  
Parent: U2 visual system (PR #25); implementation: PR #27.

## Why
The user wants an iLovePDF-like page grid for common structural actions, with stronger visual clarity and mobile comfort. The old organizer already had drag-and-drop, checkbox selection, directional moves, duplication, removal, undo and real structural exports. It lacked a straightforward action on the page image, range selection and an enlarged document preview.

## Delivered
1. **Click/tap to select**: every page image is a keyboard-accessible button. A selected card changes visual appearance and synchronises its checkbox and `aria-pressed`. This selection is not a PDF transform.
2. **Shift-click range**: select page A, hold Shift and select page C to include every intermediate output position; duplicates remain separate output items with unique IDs. A normal click toggles one item.
3. **Enlarged native preview**: a Preview button opens a native accessible dialog, rendering the source page with existing local PDF.js thumbnail infrastructure (bounded backing canvas). The preview does not upload or alter bytes. It can select/deselect the page, then returns focus to the originating button.
4. **Page cards**: clearer position badge and source page label, restrained hover state, 44px-friendly mobile actions, selected colour, thumbnail zoom affordance, high contrast and reduced motion.
5. **Preserved operations**: drag reordering, Move left/right, Duplicate, Remove, Select all, Deselect, Delete selected, Undo/Redo, comma-separated advanced page plan, complete output and work recovery all continue using existing engine/state.
6. **Cross-device tests**: programmatic range selection and undo; preview accessibility state, focus and source-order preservation.

## Explicit boundaries
- U3 changes only the **Organize pages** workspace. The dedicated **Remove pages**, **Extract pages**, Merge, and Split tools will receive matched visuals in later releases, not fake shared interfaces.
- The zoom dialog uses a bounded PDF.js render; it is for page identification and review, not proof-quality inspection at arbitrary scale.
- Shift-click requires a keyboard; on touch devices use per-page selection and Select all; a future gesture/long-press alternative requires usability research.
- Structural processing and page-copy preservation limits from the main documentation are unchanged.
- Neither success metrics nor Safari/Android real-device behaviour is claimed without measurements.

## Acceptance
- An uploaded 4-page fixture renders 4 cards with navigable buttons.
- Page 1 click + Shift-click page 3 selects pages 1–3 while order input remains `1,2,3,4`.
- Delete selected and Undo update the visual cards and deterministic page plan.
- Preview page 2 renders its source without changing order. Selecting from the dialog updates the same card, closes the dialog, and restores focus.
- Keyboard and touch targets are usable at 375px, 390px, 768px and desktop widths without horizontal body overflow.
- Run TypeScript, lint, unit, build, Chromium/Firefox/WebKit. Confirm actual PDF export tests remain green.

## Next UI work
- Make the **Remove pages** and **Extract pages** source thumbnails directly selectable, with clear inclusion/exclusion states and page-range field synchronisation.
- Show drag handles, keyboard reorder affordances and an intuitive drop target for merging documents.
- Standardise PDF reader toolbar/zoom/page navigation, mobile file/options sheets and download review across 29 currently implemented tools.
