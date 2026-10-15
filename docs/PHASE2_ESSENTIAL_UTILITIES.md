# DocFlow Phase 2 — Essential PDF utilities

Five locally processed tools are added without replacing the PDF editor or the existing 18 registered tools.

## Capabilities
- **Crop PDF:** choose one/multiple pages and trim visible bounds by point margins. Updates the page CropBox, preserving original media geometry and underlying page content. **Not secure redaction.**
- **Search & extract text:** PDF.js reads selectable text locally page by page, reports page matches, and downloads a UTF-8 text export. Scans without a text layer require OCR; none is pretended.
- **Annotate PDF:** add baked-in text notes, coloured highlight *regions* and rectangle outlines. These are page-content marks, **not** native editable PDF annotation objects, anchored text selections or redactions.
- **Visual signature:** mouse, touch or pen ink drawn on a local canvas, or typed-name fallback. Drawing is transient and passed only to a same-origin worker for PDF export. **Not a cryptographic/certificate-backed digital signature.**
- **Edit document properties:** edit/clear common PDF Info fields (title, author, subject, keywords, creator). This does **not** guarantee removal of XMP, attachments, incremental-update history or other hidden metadata.
- **Improved image import:** A4, US Letter, original aspect dimensions, portrait/landscape/automatic rotation, margins and optional scaling; PNG/JPEG streams remain embedded rather than being arbitrarily re-encoded.

## Privacy / architecture
All operations run in the browser; no document uploads or additional Supabase tables. Signature, annotation, search and property-edit field values are excluded from local recovery settings. Original local sources remain unmodified; new documents are exported as downloads.

## Release verification
- Unit-level reopened PDF geometry, metadata, annotation/signature and import sizing tests.
- Playwright end-to-end downloads and reopened PDF checks for each tool; text search exports selectable text.
- Existing test matrix, npm audit, typecheck, lint, build, and Chromium/Firefox/WebKit suites.
- Production Pages post-deploy real PDF workflow verification.

## Limitations
Crop margin coordinates reflect PDF unrotated page coordinates. Visual signature and annotation positions are percentages from the page crop box. Existing rotations/complex transforms may require adjustment; none of these marks constitute signed certificate forms, semantic text annotations or secure redaction.
