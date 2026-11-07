# Existing PDF content editing

User goal: finish the remaining DocFlow stages sequentially, continuing after each deployment. Stage 1 makes existing PDF text and images directly editable and preserves unrelated document content. Baseline is draft PR #36 at 56b7a9d. This is an architectural extension of the existing editor, not a replacement app.

## Selected architecture

Use pinned @embedpdf/pdfium 2.15.1, its MIT wrapper and bundled PDFium/third-party notices. PDFium supplies actual page-object enumeration, text replacement, image replacement, deletion and non-incremental saving. A commercial SDK would add licensing and service dependencies; a raster or white-cover approach would not replace source content. The local PDFium option can prove the required operation without introducing hosted uploads in this stage.

A source SHA-256 binds page/object IDs and every edit to the original bytes. Native edits are a serialisable part of the existing EditPlan and EditHistory, so undo/redo and navigation retain them. Apply all native edits to the original source, then run existing additions only when needed. The on-page preview renders the resulting PDF bytes; DOM boxes only select objects and never impersonate changed source text.

## Contract and behaviour

- NativeInspection contains fingerprint, page, frame and objects with stable page:index IDs, kind, text/font, visible bounds, editable and a concrete unsupported reason.
- NativeEditPlan contains fingerprint and text/image/remove changes. Duplicate IDs, stale source, nonexistent objects, oversized data and mismatched kinds are rejected before an output is returned.
- Native text replacement preserves the original font and transform by default. Unsupported glyphs or ambiguous source encodings fail explicitly. An explicit bundled DocFlow font choice permits substitution; the real PDF preview shows its layout before download.
- Images are replaced at their existing matrix, with dimensions and decoded pixel budgets checked. Shared-image tests must prove that another use is unchanged.
- Nested forms, path and inherited text clipping, marked content, invisible/clipping text, image graphics transparency/blending, unsupported transforms/encoding and signed/certified documents are guarded. Font substitution is also guarded for text with transparency/blend effects. The UI explains a supported alternative; it never silently flattens the page or modifies a signed original.
- Original input bytes remain immutable. Input budget is 150 MB per file / 250 MB combined. A native plan is limited to 1,000 changes and the existing 16 MB edit-plan budget. Decoded images are limited to 16 million pixels and 8,192 pixels per dimension.
- All allocations, pages, text pages, documents, image bitmaps and file writers are released on errors. Workers keep the existing 120-second deadline and cancellation boundary.
- A pending native text input survives navigation, even before Apply. Committed native changes share Undo/Redo with additions. Preview generations ignore stale results, preserve page/zoom and revoke temporary data when the session resets.

## Files and ownership

- src/pdf/nativeModel.ts: serialisable and resolved native edit/inspection types and input validation.
- src/pdf/nativePdfium.ts: low-level object inspection/mutation, geometry, memory and save ownership.
- src/pdf/nativeEditing.ts: lazy engine loading, document policy, image decoding and adapter orchestration.
- scripts/stage-native-assets.mjs: deterministic WOFF-to-sfnt conversion of the existing licensed font; generated font remains a build asset.
- src/v2/nativeEditor.ts: source selection and native properties UI, pending input state, history callback.
- Existing worker, EditPlan, EditorDraft, editor, app and styles connect these boundaries.

## Evidence and release boundary

Tests must independently reopen saved bytes with PDF.js and pdf-lib/PyMuPDF, verify replaced text is selectable and old text gone, and inspect image pixels, unchanged uses, page boxes, annotations, links, forms and metadata. Use at least 30 deterministic fixtures across invoices, CVs, reports and forms, including crop/rotation, embedded/subset fonts, images and unsupported grouped/clipped content. Record supported/rejected cases and timings; synthetic corpus results do not substitute for physical-device and real-document acceptance.

Sources: https://www.embedpdf.com/docs/pdfium/introduction ; https://pdfium.googlesource.com/pdfium/+/main/public/fpdf_edit.h ; https://pdfium.googlesource.com/pdfium/+/main/public/fpdf_save.h .

The user authorised all stages and sequential execution; routine implementation and publication decisions proceed under that instruction. Deployment remains governed by measured capability/parity acceptance, not merely a green subset of tests.
