# Phase 5 — Permanent raster redaction and cautious PDF repair

## Redaction: erase original PDF structure, not merely cover it

**Operation:** Permanent redaction. Select PDF, draw regions on a visual page preview or enter x/y/width/height as percentages, review all page positions, explicitly accept loss of text/vector data, then export.

Security invariant: **a new, clean PDFDocument is built exclusively from PNG images of PDF.js-rendered pages with the redaction masks painted before embedding.** It does not copy original PDF content streams, selectable text, attachments, form widgets, annotations, bookmarks, scripts, XMP, signatures, document history, hidden layers or original metadata. All pages are rasterized (even unmarked pages); text search, vectors, digital signatures, accessibility tagging and editable fields are not preserved. Results should be checked visually, including whether all intended regions were marked. Source files remain unchanged and are not uploaded.

- Drag a rectangle directly on the preview canvas. The mask is visually opaque.
- Keyboard-accessible percentage coordinate inputs as an alternative.
- Per-page marking, navigation, undo and clear.
- Strict normalized-coordinate validation: inside page, finite values, >=0.5% in width and height; at least one area.
- Per-operation bounds: **15 pages, 40 MB input, 120 masks**, conservative render canvas pixel ceilings. Large documents should be split first.
- Rendered annotations with appearances are included by PDF.js when available. Some dynamically generated content, interactive forms or unsupported PDF constructs may not render correctly; check the preview and exported copy, or use a more capable PDF tool when fidelity is critical.
- Uses lossless PNG screenshots to avoid JPEG compression bleeding near redaction boundaries; mask is expanded by ~2 pixels into neighbouring content.
- Encrypted PDFs are not processed by redaction directly; unlock with a legitimate password using the existing local Unlock PDF tool first.
- Cancel operation; output not persisted. Preview bytes and bitmap canvases cleared after use.
- Not legal/compliance certification of redaction adequacy: human verification is still needed, and external copies and caches of the *original* file are not altered.

## Repair: structural reconstruction, not recovery from arbitrary corruption

**Operation:** Repair PDF. Uses the existing **qpdf 12.3.2 WASM** engine locally. Runs a qpdf `--check` pass with structural rewrite and preservation of compressed stream data. Exit code 3 (warnings) is treated as a cautiously recoverable case only when an output is written. Errors or no output fail closed. Runs a post-export PDF.js load/getPage verification on the new file before download. Delivers warnings where qpdf reported them.

- Attempts reconstruction of corrupted xref, trailer and related references qpdf supports.
- Does **not** reconstruct missing content, repair all damaged images, guarantee document integrity, remove passwords, or undo malicious modifications.
- Can change PDF serialization and structure, but preserves selectable text on normal inputs.
- No document is sent to Supabase or another processing service; no new account/cloud configuration.

## Validation

- Unit: rectangle normalization, invalid geometry rejection, memory bounds.
- Browser: exported image-only PDF contains no selectable text on any page, no source metadata strings or original form fields, preservation of page count, explicit informed-confirmation checks, keyboard/mobile region entry.
- Repair: reopen qpdf output and extract original selectable text with PDF.js.
- Existing regression suites: npm audit, TypeScript, lint, unit tests and build; Chromium/Firefox/WebKit; GitHub Pages post-deployment tests.

## Known tradeoffs

Secure raster redaction changes representation: text and vector searchability and digital signatures are lost everywhere. Small or complex fonts, corrupted PDFs, unsupported drawing APIs, XFA and specialised content can render differently. Preview-to-export coordinates follow PDF.js rotated *visible viewport* percentages; review exported redaction boxes, especially on rotated pages. Repair is conservative and makes no guarantee of full recovery.

## Sources

qpdf CLI documentation: https://github.com/qpdf/qpdf/blob/main/manual/cli.rst — warnings/exit codes and `--check`.
PDF.js API docs: https://mozilla.github.io/pdf.js/api/draft/api.js.html — page render and annotation mode.
