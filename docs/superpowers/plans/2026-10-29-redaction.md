# Permanent redaction v2 implementation plan

> Execute inline as the next approved missing adapter; preserve proven raster-redaction semantics.

**Goal:** Let a person mark confidential regions visually or by keyboard, review the actual image-only output and download a new PDF containing no original PDF objects.

**Architecture:** A disposable mask overlay stores normalized rectangles in a session draft with bounded undo/redo. The existing `redactPdf` rebuilds every page into a fresh PDF; no source page objects are copied. A dedicated result preview renders the actual exported bytes. Source and result preview lifetimes are separate and cancellation aborts the engine.

**Spec:** `docs/DELIVERY_PROGRESS.md` and the existing secureRasterRedaction domain contract.

- [ ] Observe failing v2 journeys for coordinate/drawn regions, undo and preserved draft; explicit rasterization acknowledgment and actual output object/text/metadata removal; cancellation and 15-page/40 MB caps.
- [ ] Add `src/v2/redaction.ts`: pointer rectangles, accessible coordinate controls, remove/jump list, 50-step history and at most 120 regions. Block edits while processing; cancel a drag on page changes/disposal.
- [ ] Connect the catalog, pre-read input cap, preview/page cap, confirmation and `redactPdf` with AbortController. Keep source draft/settings through Back. Copy marks into a fixed export snapshot.
- [ ] Add `src/v2/pdfReview.ts`: render the actual output, bounded canvas, next/previous page and abort/dispose. No downloading a different regeneration after review.
- [ ] Verify exported PDF independently: image-only pages, no secret text/metadata/attachment/form references, black pixels inside the selected area, and readable retained visual areas. Run current v2 journeys, units and quality checks; fresh read-only review, fix important defects, publish exact verified tree.

Review focus: viewport rotation/crop/zoom coordinates; stale drag/async result; original hidden objects never copied; input/page/history/mask bounds; accessible controls and focus after removal; every page loses text/structure even if unmarked. This is raster redaction with a quality cap, not semantic text-preserving redaction or a legal-certification claim.

## Ledger

Task complete: unavailable-adapter regression observed failing, followed by seven real redaction browser journeys and all 59 v2 Chromium cases passing. Reopened output verifies no original text/metadata/attachment/form objects and expected pixels. 200 units/typecheck/lint/build pass. Fresh review found two important defects: paper-minimum-height mask drift and a cancelled drag remaining visibly black. Both have observed failing regressions and pass after exact-canvas positioning and cancellation repaint. The source fixture contains an actual attachment/form field. Publish this verified tree and require fresh cross-browser CI.
