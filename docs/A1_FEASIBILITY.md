# A1 engine decision — 18 October 2026

The approved roadmap requires a small isolated prototype and a written admission decision before advanced capabilities ship. The next bounded increment is A1.1: native editable region highlights using the already pinned pdf-lib 1.17.1 engine. This decision does not complete the broader A1 track.

## Candidate assessment

| Candidate | Evidence | Decision |
|---|---|---|
| Existing pdf-lib 1.17.1 low-level objects | MIT dependency already recorded in the lockfile/provenance. Prototype generated Highlight dictionaries, QuadPoints and explicit Form XObject appearances. PDF.js and independent PyMuPDF 1.26.6 reopen, render and edit them on four rotated/CropBox fixtures. | **Go for single rectangular native highlights only**, subject to release CI. No new runtime dependency. |
| Existing pdf-lib for original text/image replacement or selective content redaction | Upstream explicitly lacks removal/editing APIs for existing page text outside forms. The prototype changes annotation objects only and proves no content-removal capability. | **No-go for this release.** Keep current truthful added-text boundary and permanent raster-redaction path. |
| MuPDF.js advanced content engine | Official browser/annotation/redaction documentation establishes a possible candidate. Published AGPL/commercial licensing requires an application compatibility/cost decision. App remains UNLICENSED by the owner's existing choice. | **Hold.** No MuPDF.js product dependency installed, bundled or deployed. No browser engine benchmark, commercial entitlement or licensing compatibility is claimed. |

PyMuPDF is used only as an independent development/CI verifier, as in R2/R5. This is not a browser MuPDF.js evaluation or product integration. No app license was selected and no commercial terms were accepted.

## Isolated prototype and admission evidence

The first test run against the existing editor failed the native-object and unchanged-content requirements: arbitrary region marks were page drawings. The candidate writes native Highlight annotation dictionaries and an explicit appearance stream instead. The synthetic corpus contains four offset-CropBox pages at 0/90/180/270°, searchable source text, a link, an AcroForm, bookmarks and page labels.

The independent verifier checks displayed vertices without using app coordinate helpers, colored pixels inside the mark, unchanged pixels outside it, text extraction, and comment/color edit-save-reopen. Reimporting that independently edited PDF recovers the marks in DocFlow. Tests separately preserve multi-quad/skewed geometry, locks/visibility flags, layers, reply threads and malformed data by declining to edit them. Source bytes remain untouched; the whole-document rewritten export retains the tested catalog structures.

The prototype now forms a focused module in `src/pdf/nativeHighlights.ts`, called only by the existing worker-backed direct editor. The preview copy removes admitted annotations from its annotation list; source bytes and export processing retain the originals. New and changed marks use explicit alpha/multiply appearances. No remote processing, added document storage, new font or engine asset is required. The existing 1,000-object and history memory budgets remain; this release does not raise large-document or named-device performance limits.

## Scope conditions

The editor admits an indirect Highlight object only when it has exactly one rectangular quad in supported paired-edge order of at least 8 points per axis, contained in the visible CropBox, RGB color and opacity in range, no unsupported flags, no optional-content membership and no reply relationship or shared annotation reference. These checks are deliberately narrower than the PDF format. Unsupported marks remain in the original annotation list and the preview, and a visible count explains that they are kept unchanged. Unchanged admitted marks retain their original dictionary and appearance; changing one replaces its supported geometry/content/color/appearance while retaining author, identity and popup.

PDFs with a non-default `/UserUnit` are refused by Edit PDF with a clear custom-scale explanation before inspection/export; their canvas and overlay coordinates are not yet normalized. A failed new import clears prior overlays/downloads. Other tools retain their existing contracts.

This is a region-review tool, not text-selection highlighting, multi-line semantic text markup, sanitisation or redaction. Removing a review annotation does not remove underlying page content. Whole-document rewrites still invalidate signatures; complex PDF/tag preservation is not certified. RGB editor properties use 8-bit channels.

## Next gate for broader A1

Before adopting a richer engine, resolve licensing with the owner, then run an isolated browser prototype against difficult fonts, image reuse, transparency, rotation, tags/forms/signatures, cancellation and named-device memory limits. For redaction, independently inspect content/object removal and neighboring pixels; for existing-text changes, demonstrate actual glyph/font/geometry edits. A painted cover cannot satisfy either gate.

## Primary references

Checked 18 October 2026:

- [pdf-lib upstream limitations and license](https://github.com/Hopding/pdf-lib#limitations), with the installed 1.17.1 source used for the exact low-level API signatures.
- [Adobe PDF 32000-1:2008](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf), annotation dictionaries, flags, appearance streams and text-markup QuadPoints.
- [MuPDF annotation APIs](https://mupdf.readthedocs.io/en/1.28.5/reference/javascript/types/PDFAnnotation.html).
- [MuPDF AGPL/commercial licensing](https://mupdf.readthedocs.io/en/1.28.5/license.html).

Final exact-SHA CI/deployment results belong in the release PR. Physical devices, manual assistive technology, Safari offline execution, authenticated cloud and the R7 moderated acceptance protocol remain unverified.
