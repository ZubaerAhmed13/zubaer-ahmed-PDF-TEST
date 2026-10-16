# R0 preservation baseline — corpus v1

Measured with tests/fixtures/pdfCorpus.ts and tests/preservationBaseline.test.ts. “Lossless” registry quality means no intentional page rasterisation/recompression, not byte identity or preservation of every document feature.

| Operation | Established evidence | Limits / unverified features |
|---|---|---|
| Rotate | Corpus dimensions/rotation, form value/title, Outlines, PageLabels, Names and AcroForm retained | Key presence is not arbitrary tagging/signature/reference validation |
| Merge/extract/remove/organise | Selected page text and geometry reopen | Corpus loses Outlines, PageLabels, Names and AcroForm; bookmarks/labels/attachments/editable forms not guaranteed |
| Split | Range/order/reopen tests | Fresh-document page-copy design; catalogue preservation unverified |
| Numbers/watermark/crop/annotation/visual signature | Existing geometry/content tests | Signed validity and arbitrary catalog/tag preservation uncertified; crop only hides |
| Forms | Supported values/flatten reopen | XFA unsupported; flatten removes fields |
| Optimise | Eligible JPEG size reduction plus geometry/rendering | Potentially lossy; complex colour/mask cases skipped |
| Protect/unlock | Encryption/decryption, wrong password, geometry | Not signature validation/general preservation certification |
| OCR | Real scan searchable; original dimensions retained | Approximate overlay/fonts; rotated/unsupported cases skipped |
| Redaction | Raster-only output, mask/adjacent pixels, page count | Source text/vectors/forms/attachments/tags/signatures intentionally discarded |
| Repair | Damaged xref recovery and all-page post-check | No missing-content reconstruction guarantee |
| Images/text exports | Existing artifact/pixel/text checks | Representation changes |
| Workflow/batch | Reopened chains/queues, partial failures | Quality is bounded by every executed step |

Missing catalog keys are findings, not required losses that future code must keep reproducing. artifacts/r0/preservation.json is regenerated in unit runs. R5 tackles deeper preservation.
