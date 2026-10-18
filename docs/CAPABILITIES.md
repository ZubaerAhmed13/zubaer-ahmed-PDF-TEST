# Current capability and evidence matrix

Current release: R4 / 0.6.0, 29 tool IDs; the original 28 stable IDs are retained. Test links identify coverage; passing results must be checked at the exact release SHA. Catalog preservation is not implied by a structural/lossless label.

| Tool / ID | Coverage | Important boundary |
|---|---|---|
| Edit PDF (`edit-pdf`) | [R2 exports and independent reopen](../tests/r2Editing.test.ts), [browser journeys](../e2e/r2-editing-reading.spec.ts) | Added content only; Latin/Greek/Cyrillic tested; native Text sticky notes; crop hides content. [R2 limits](R2_RELEASE.md). |
| View PDF (`preview`) | [Controls](../e2e/preview-controls.spec.ts), [R2 reader](../e2e/r2-editing-reading.spec.ts) | Selectable-text search; OCR needed for scans. Continuous mode uses a three-page group. |
| Merge PDF (`merge`) | [Browser coverage](../e2e/app.spec.ts) | Structural/catalog limits: see [preservation baseline](R0_PRESERVATION_MATRIX.md). |
| Split PDF (`split`) | [Browser coverage](../e2e/release.spec.ts) | Structural/catalog limits: see [preservation baseline](R0_PRESERVATION_MATRIX.md). |
| Remove pages (`remove-pages`) | [Browser coverage](../e2e/release.spec.ts) | Structural/catalog limits: see [preservation baseline](R0_PRESERVATION_MATRIX.md). |
| Extract pages (`extract-pages`) | [Browser coverage](../e2e/release.spec.ts) | Structural/catalog limits: see [preservation baseline](R0_PRESERVATION_MATRIX.md). |
| Organize pages (`organize`) | [Browser coverage](../e2e/organize-workspace.spec.ts) | Structural/catalog limits: see [preservation baseline](R0_PRESERVATION_MATRIX.md). |
| Rotate pages (`rotate`) | [Browser coverage](../e2e/release.spec.ts) | Structural/catalog limits: see [preservation baseline](R0_PRESERVATION_MATRIX.md). |
| Permanent redaction (`redact-secure`) | [Browser coverage](../e2e/professional-redaction-repair.spec.ts) | All pages rasterised; 15 pages/40 MiB/120 masks. Review visible output. |
| Repair PDF (`repair-pdf`) | [Browser coverage](../e2e/professional-redaction-repair.spec.ts) | Supported structural corruption only; all pages post-checked, missing content not reconstructed. |
| Crop PDF (`crop`) | [Browser coverage](../e2e/essential-utilities.spec.ts) | CropBox hides content, not redaction. |
| Annotate PDF (`annotate`) | [Browser coverage](../e2e/essential-utilities.spec.ts) | Baked-in marks, not editable PDF comment objects. |
| Visual signature (`sign-visual`) | [Browser coverage](../e2e/essential-utilities.spec.ts) | Visible mark only, no certificate signature. |
| Edit document properties (`metadata-edit`) | [Browser coverage](../e2e/essential-utilities.spec.ts) | Standard Info fields only, not hidden-data sanitisation. |
| OCR scanned PDF (`ocr`) | [Browser coverage](../e2e/phase3-ocr-comparison.spec.ts) | English/German/mixed; selected ranges in 30-page chunks; rotation/deskew-aware Unicode overlay. Approximate word placement; review required. [R4 limits](R4_RELEASE.md). |
| Compare PDFs (`compare`) | [Browser coverage](../e2e/phase3-ocr-comparison.spec.ts) | Heuristic text/scan page matching, moves, word changes and navigable reports; first 50 pages/document. Downscaled visual analysis; uncertain matches are marked. |
| Search & extract text (`text-search`) | [Browser coverage](../e2e/essential-utilities.spec.ts) | Structural/catalog limits: see [preservation baseline](R0_PRESERVATION_MATRIX.md). |
| Add page numbers (`page-numbers`) | [Browser coverage](../e2e/release.spec.ts) | Structural/catalog limits: see [preservation baseline](R0_PRESERVATION_MATRIX.md). |
| Add watermark (`watermark`) | [Browser coverage](../e2e/image-watermark.spec.ts) | Structural/catalog limits: see [preservation baseline](R0_PRESERVATION_MATRIX.md). |
| Images to PDF (`images-to-pdf`) | [Browser coverage](../e2e/release.spec.ts) | Structural/catalog limits: see [preservation baseline](R0_PRESERVATION_MATRIX.md). |
| PDF to images (`pdf-to-images`) | [Browser coverage](../e2e/color-fidelity.spec.ts) | Structural/catalog limits: see [preservation baseline](R0_PRESERVATION_MATRIX.md). |
| Extract images (`extract-images`) | [Browser coverage](../e2e/extract-images.spec.ts) | Decoded rasters, not original compressed-byte extraction. |
| Fill PDF forms (`forms`) | [Browser coverage](../e2e/forms-matrix.spec.ts) | Supported AcroForm only; XFA unsupported; flatten removes fields. |
| Protect PDF (`protect-pdf`) | [Browser coverage](../e2e/encryption.spec.ts) | Structural/catalog limits: see [preservation baseline](R0_PRESERVATION_MATRIX.md). |
| Unlock PDF (`unlock-pdf`) | [Browser coverage](../e2e/encryption.spec.ts) | Structural/catalog limits: see [preservation baseline](R0_PRESERVATION_MATRIX.md). |
| Document information (`metadata`) | [Browser coverage](../e2e/input-resilience.spec.ts) | Structural/catalog limits: see [preservation baseline](R0_PRESERVATION_MATRIX.md). |
| Optimize PDF (`compress`) | [Browser coverage](../e2e/professional-compression.spec.ts) | Selective eligible RGB JPEGs; complex colour/mask cases skipped. |
| Workflow builder (`workflow`) | [Browser coverage](../e2e/workflow-builder.spec.ts) | 1–8 steps, 20 files, 50 MiB/file, 150 MiB total; presets local. |
| Batch process PDFs (`batch`) | [Browser coverage](../e2e/batch-workspace.spec.ts) | Sequential queue; quality follows selected operation. |

All workspaces also pass through [registry loading/error checks](../e2e/r0-baseline.spec.ts). Existing-text replacement, certificate signing, Office conversion, PDF/A and PDF/UA are not advertised as implemented. [R0 release record](R0_RELEASE.md).

## Offline and mobile readiness

[Offline setup and system export](R3_RELEASE.md) enumerate the certified automated journey and pending physical-device/assistive-technology checks. Readiness checks actual cache entries; prepare OCR languages explicitly before disconnecting. Cache availability is not document backup or universal device certification. Downloads always remain available; system file sharing appears only where supported.

## R5 preservation, safety and budgets

All PDF workspaces show export consequences and a cancellable local structural inventory, including signature/certification, actions, attachment and link flags. No signature validation or malware-scanning claim. Raster redaction adds requested DPI, effective canvas sizing, individual area review and an exact-size draft before download. Shared worker/input/loading/canvas budgets and bounded thumbnails apply as documented in [R5_RELEASE.md](R5_RELEASE.md). Reproducible CI ZIPs include content checksums and a pinned vendor/dependency provenance report; root application license choice remains with the owner.

## R6 recipes and output review

Versioned local recipe import/export, sequential page-aware preflight, keep-selected-pages and ranged watermark steps, configurable names, original-source selected retries and retained successes. Common export panels expose exact size/format, rename, source-bound comparison, preview and one-time adoption into the shared session. Encrypted results remain download-only; redaction clears prior session history. See [R6_RELEASE.md](R6_RELEASE.md) for budgets, review coverage and the conditional OCR/navigation-editing boundaries.
