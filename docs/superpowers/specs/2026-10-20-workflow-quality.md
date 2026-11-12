# DocFlow 2.0 workflow and processing quality

The user approved the critical-review plan on 20 October and asked us to apply iLovePDF's tool/upload/visual-work/download simplicity, Adobe's actual-object editing direction and PDF24's quality/resolution processing depth. Official documentation confirms all three. Structural-only compression remains useful for some text PDFs; image recompression is appropriate only when it preserves required document features.

## Deliverable

Complete a reliable editing journey on the existing v2 branch: preserve draft/history/settings across export and browser navigation; search without leaving the document; accurately scale added text using the same embedded font as export; provide actual mobile zoom and accessible options; give the organiser thumbnail ordering with drag and non-drag controls; add advanced image quality and maximum-pixel controls wired to the proven worker; expose before/after bytes and warnings; keep output downloadable and allow returning to editing.

No product dependency or public deployment is required for this slice. Passwords remain in the current view only and must never enter retained option state. A source replacement starts a new draft after confirmation. Navigation and concurrent async work must not let old previews/results overwrite another session. Keep all current tool adapters and PDF bytes intact.

## Actual-object editing direction

Current Edit PDF adds objects and annotations. Replacing existing PDF text/images is a separate object-aware-engine project with font/subset/encoding/clipping and fidelity requirements. Do not implement a white rectangle over existing text or describe annotations as original-text replacement. Record a concrete engine-evaluation contract and release boundary. This release must accurately say what its current editor supports.

## Acceptance

- Added text, object positions, undo/redo, selected pages and options survive result→work and Back/Forward.
- Tool search is a dismissible dialog over the current document; cancellation preserves it.
- New files, Start over and a different tool cannot silently destroy a loaded document.
- Text preview scales from PDF points using DocFlowSans, the export font; explicit line breaks and overflow must be truthful.
- Phone zoom changes displayed page dimensions and supports access to all edges; landscape keeps Run visible.
- Options has a Close control, focus restoration and Escape support. Its non-modal presentation permits canvas and Run interaction.
- Organiser output order is visible in thumbnails, supports drag/drop plus buttons, survives returning from results and exports the tested structural order.
- Advanced compression uses JPEG quality 50–95% and maximum image dimension 900–5000 pixels; don't mislabel this pixel ceiling as DPI.
- Compression results report actual input/output bytes, compression effectiveness and eligible/recompressed image counts; warnings are visible.
- Original text, page counts and structural content remain intact in actual downloads.

## Source of requirements

The user's approved `DocFlow_2.0_Critical_Review_and_Upgrade_Plan_2026-10-20.md`, draft PR #36, and https://www.ilovepdf.com/help/documentation ; https://helpx.adobe.com/acrobat/web/edit-pdfs/edit-text-images-and-objects/edit-text.html ; https://tools.pdf24.org/en/compress-pdf .
