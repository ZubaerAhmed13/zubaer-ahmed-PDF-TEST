# R4 — OCR, photo capture and document comparison (0.6.0)

R4 extends the existing local tools and shared document session. All 29 tool IDs, GitHub Pages hosting and the preference-only cloud boundary are retained.

## Delivered behavior

- OCR accepts selected page ranges and processes at most 30 selected pages per run. Reports list untouched pages and chunk limits. Retry chosen pages from the original file; source pages are preserved. Existing selectable text can be skipped.
- English, German and mixed English/German use the packaged same-origin models. Rotation (quarter turns), manual deskew (±15°), grayscale, contrast/background stretching and black/white cleanup have before/after review. Settings affect recognition, while the source scan stays visible.
- Invisible, embedded-font Unicode text maps through the inverse preprocessing transform and PDF.js viewport transform, including page rotation and an offset CropBox. Word placement remains approximate. Confidence below 38, unsupported glyphs and the 3000-word overlay limit are disclosed; the UTF-8 recognition report includes the full engine text. No additional scripts/languages are advertised.
- Offline & storage shows download sizes and verified ready/missing state. Explicit model removal deletes that language's CacheStorage asset and the legacy Tesseract IndexedDB key, retaining shared engine files and the other language. R4 avoids a second hidden model cache.
- Images to PDF adds explicit device camera capture through the file picker, per-photo clockwise crop/perspective corners, rotation, manual deskew and cleanup. Before/after review applies the correction. Up/down buttons control export order. Uncorrected images retain the original embedding path; corrected photos are re-encoded as PNG, bounded to 4 megapixels / 2400-pixel maximum input dimension.
- PDF comparison first matches pages by normalized selectable text or coarse scan fingerprints, then reports added/deleted pages, moves, word additions/removals and downscaled visual differences. Both panes navigate the same matched pair. Pixel and changed-area tolerances are adjustable. Reports export as plain text and a self-contained navigable HTML file, with document content escaped.
- Text extraction also exports literal Markdown, preserving page and line boundaries and escaping markup. It does not infer tables, headings or layout-faithful reading order.

## Measured OCR corpus

Reproduce with `npm run benchmark:ocr`. CI retains `artifacts/r4/ocr-benchmark.json` including per-image checksums, recognized text and timing. The fixed generated inputs/reference text live in `tests/fixtures/ocr-corpus/`; regeneration requires Pillow and Debian DejaVu fonts. No private documents are used.

Initial local run: Tesseract.js 7.0.0, packaged LSTM models, original pixels without cleanup; Unicode NFC, collapsed whitespace, retained case/punctuation. Character error rate (CER) is Unicode code-point Levenshtein edits / reference characters. The clean ≤2% target is release-blocking in CI.

| Fixed subset | Images | Reference characters | Edits | CER |
|---|---:|---:|---:|---:|
| Clean English/German (sans, serif, bold) | 6 | 1263 | 0 | 0.000% |
| Difficult (5° skew; low contrast + blur) | 4 | 842 | 3 | 0.356% |
| Mixed English/German | 1 | 149 | 0 | 0.000% |

These small synthetic measurements are regression evidence, not a general accuracy claim. Handwriting, complex layouts, shadows, camera noise and additional scripts are not certified. The Node benchmark measures the same packaged recognition engine/models; browser export and geometry have separate tests.

## Verification and boundaries

- Unit coverage: `tests/r4DocumentQuality.test.ts` checks insertion, deletion, true moves, ambiguous/repeated/blank pages, scan fingerprints, word changes/truncation, inverse transforms, perspective corners and filter behavior. PyMuPDF independently reopens four rotated/CropBox outputs, verifies Unicode extraction and invisible text, and confirms visible pixels remain white.
- Browser coverage: `e2e/r4-document-quality.spec.ts` exercises comparison navigation/HTML report/Axe, reviewed photo correction/reordering/export/reopen, a selected rotated/CropBox mixed-language scan with Unicode extraction, incomplete comparison and Markdown output. Production includes these journeys.
- Comparison is heuristic, not semantic or legal review. Blank/repeated pages and heavy revisions can be uncertain; scan matching is especially approximate. Visuals are 440×600 previews and can miss small changes. At most the first 50 pages per document are matched. Word diffs stop at 600 words per side, with explicit incomplete markers. A PDF's content-stream text order is not guaranteed reading order.
- Deskew and perspective are user-controlled; there is no claim of automatic edge or orientation detection. OCR preprocessing settings apply to all selected pages in that run. Camera capture availability is device-dependent; physical camera/device acceptance remains manual.
- The existing R3 Safari offline execution, physical-device and manual assistive-technology verification boundaries still apply. No PDF/A, PDF/UA or tagged-PDF claim is introduced.
- Final release is gated on the exact candidate's unit/build/audit, three-browser regression jobs, Pages deployment and production export/reopen checks. The PR records the final SHA and results.

Technical references: [Tesseract quality guidance](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html), [Tesseract.js worker API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md), installed PDF.js 4.10.38 viewport transforms and pdf-lib 1.17.1 text operators. Transform and export behavior are validated by fixtures rather than inferred from API availability.
