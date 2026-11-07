# Original PDF content editing: evaluated direction and release boundary

20 October 2026

## Verified product requirements

- iLovePDF's [organiser documentation](https://www.ilovepdf.com/help/documentation) describes file selection, visible page thumbnails, direct rearrangement and a separate processed download.
- Adobe's [text editing documentation](https://helpx.adobe.com/acrobat/web/edit-pdfs/edit-text-images-and-objects/edit-text.html) describes selecting source text, replacing/deleting it and changing formatting. This is different from adding annotations.
- PDF24's [compression tool](https://tools.pdf24.org/en/compress-pdf) exposes DPI and image-quality options alongside structural changes. Structural rewriting can help text PDFs; image-heavy PDFs need an appropriate image pipeline. The v2 browser worker currently handles eligible RGB JPEG XObjects, not every image encoding.

## Actual-object engine candidates

The current pdf-lib additions editor does not replace original PDF text/image objects. Changing a label or covering source content with a white rectangle does not satisfy that requirement.

1. **PDFium native object APIs.** The [official edit API](https://pdfium.googlesource.com/pdfium/+/main/public/fpdf_edit.h) exposes page-object enumeration, text-object modification (`FPDFText_SetText`), image-object operations and regeneration (`FPDFPage_GenerateContent`). The header identifies BSD-style licensing. These are low-level capabilities, not a complete paragraph editor. A trial adapter must handle source font coverage, subset encodings, nested Form XObjects, transforms, clipping and stale-object identity. Third-party notices must accompany any bundled build.
2. **Commercial full-content editor SDK.** Evaluate a supported content-editing SDK if the low-level route fails fidelity or resource requirements. Apryse's [ContentReplacer API](https://sdk.apryse.com/api/web/Core.PDFNet.ContentReplacer.html) illustrates native text/image replacement, but its template replacement helper is not by itself evidence of a complete arbitrary-document editor. Do not add a trial watermark, licence key dependency or paid runtime to the app without a concrete evaluation and owner decision.

## Required adapter contract

An inspection returns source fingerprint, page/object identifiers, object kind, bounding geometry, transform, text/font metadata and editable/unsupported reason. Edits refer to that fingerprint and object identifier, not only coordinates. A write must reject stale or unsupported edits rather than silently substituting or flattening the whole page.

Prototype the complete inspect → select source object → replace text/image → regenerate → save → reopen path. Use actual exported bytes and independent PDF.js rendering/text extraction. Font substitutions and layout changes require explicit review. The engine can execute in a worker or an isolated backend; hosting location does not determine fidelity.

## Evaluation corpus and release gate

- Start with 30–50 representative CVs, invoices, reports, forms and mixed text/image PDFs.
- Include embedded/subset fonts, glyphs absent from subsets, ligatures, rotated/cropped pages, shared images, transparency/clipping, nested forms, CJK/RTL shaping, signed and encrypted documents.
- Verify the old text is actually replaced, replacement remains selectable, image-object changes affect only intended uses, and unrelated content remains intact.
- Compare independent page renders, text positions, reading order, links, forms, annotations, metadata and page boxes. Record unsupported cases instead of reporting universal support.
- Measure runtime/peak memory on named reference devices and isolated workers. Reject results that merely rasterize an entire document or lose required structure.
- Assess licensing, deployment and retention with the selected engine before exposing uploads.

**Status:** requirement and candidates verified; native-content editing and hosted processing are not part of the workflow-quality implementation. The interface accurately describes additions and annotations until the adapter and corpus gates pass. No server endpoint, licence or native-editing capability is simulated.
