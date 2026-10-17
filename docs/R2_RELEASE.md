# R2 — direct editing and reading, version 0.4.0

R2 adds Edit PDF while retaining all 28 existing tools and the R1 document session.

## Delivered behavior

- Added text, images, rectangles, highlight regions, visual signatures and native sticky-note comments can be selected, moved, resized or deleted directly on the visible page. Shift selects several objects. Numeric properties, keyboard nudging, duplication, alignment, copy to other pages, and command undo/redo provide alternatives to pointer work.
- Crop frames have four drag handles, numeric properties, keyboard movement and optional snapping to page edges/center. Crop changes visibility; it does not securely remove content.
- Geometry uses the visible rotated CropBox. Export is checked at 0/90/180/270 degrees with an offset CropBox.
- Added text embeds a local font. Latin, Greek and Cyrillic are tested. Missing glyphs and unsupported shaping/bidi produce explicit export errors. Original page text replacement remains outside R2.
- Sticky-note comments are native PDF Text annotations, imported into the editor and editable or removable. Unrelated annotations are preserved. Rectangles/highlight regions remain baked content; the existing Annotate PDF tool also remains available. Native threaded replies, rich text, ink and native text highlights are outside this supported subset.
- View PDF has selectable text, document search with match navigation and highlighting, page jump, document outlines, internal links, external HTTP/HTTPS/mailto links, and a plain accessible text view. Continuous page group renders the current page and neighbors; select Read page to advance its bounded three-page window. This avoids rendering an entire long document at once.
- Form widgets overlay the PDF preview and synchronize with the accessible field list and advanced JSON. Next/previous field moves between pages. Required validation, read-only values, reset and an exact flattened PDF appearance preview are included. XFA remains unsupported.

## Resource and privacy boundaries

Files, signatures, added content and form values stay in memory in this tab. They are not added to recovery storage. Export before leaving. Edit history retains up to 65 states, pruned to a 32 MB serialized budget (at least the last two states); a plan is limited to 16 MB and 1,000 objects. Images are PNG/JPEG up to 10 MB. Reader search reports up to the first 5,000 matches. Text must fit its box to export. The existing document-session budget and leave/update protections remain active.

## Verification

Local typecheck, lint, build, audit and 74 unit tests pass. Export fixtures are independently reopened using PDF.js and PyMuPDF 1.26.6. MuPDF checks exact red-shape pixels in display coordinates at four rotations, Unicode extraction, crop dimensions, native comment edit/save/reopen, form values and identical flattened/unflattened form pixels. The CI quality job retains artifacts/r2 beside the R0 preservation baseline.

The full three-browser suite includes R2 editor, reader and form journeys. Production runs reuse these export/reopen assertions. CI and deployment evidence is recorded in the release PR after the final candidate passes.

Physical-device, assistive-technology and manual Adobe/Preview compatibility certification are not claimed by automated checks. Original PDF text editing and arbitrary annotation editing remain advanced roadmap work.

## Implementation references

- PDF.js page, text, annotation and viewport APIs: https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html
- pdf-lib custom font embedding: https://pdf-lib.js.org/docs/api/classes/pdfdocument
- DejaVu distribution and font provenance: public/fonts/README.md and DejaVu-LICENSE.txt
- Independent verifier: scripts/verify-r2-pdf.py; regression fixtures: tests/r2Editing.test.ts and e2e/r2-editing-reading.spec.ts
