# Phase 3 — Local OCR and PDF comparison

## Shipped scope

### Searchable scanned PDFs
- Two offline-capable languages: English and German.
- Uses the pinned Tesseract.js v7 and tesseract.js-core WebAssembly engine with pinned npm language datasets. The worker, core and model files are **copied at build time and served from the same DocFlow GitHub Pages origin**. No default Tesseract CDNs and no cloud OCR service.
- Engine and language model are lazy-loaded on first use. First OCR use requires connectivity if model assets are not yet cached; subsequent use works from the app's same-origin service-worker cache and Tesseract IndexedDB model cache.
- PDF.js renders one page at a time. Tesseract recognises words and their bounding boxes; pdf-lib adds transparent text onto the original PDF page. **Original scanned page imagery remains visible**, with approximate bounding boxes.
- Existing selectable text pages are skipped by default. Explicit processing bounds at 30 pages per operation. Unsupported/rotated pages are reported instead of pretending OCR was applied.
- User gets both `searchable-ocr.pdf` and `ocr-recognized-text.txt` with page-level progress and cancellation. Processing occurs locally; model downloads are from the site's own origin.
- Accuracy depends on original scan DPI, quality, font, language and orientation. Low-confidence words are skipped. Standard Helvetica font limits character support; difficult Unicode glyphs may not be embedded. Always review the output.

### PDF comparison
- Two PDFs, compared at matching page positions.
- Modes: text only, visual only, text plus visual.
- PDF.js produces text data and rasterised page images. Difference detection marks per-page textual changes and percentages of changed image pixels.
- Side-by-side image snapshots and difference mask, with adjustable opacity slider, and a downloadable local text report.
- Explicit maximum of 50 page positions with an **incomplete comparison** warning when the document is longer.
- Comparison uses fixed-sized downscaled samples, thresholded pixel differences; not full-resolution pixel-perfect proof. It does not reorder, align, or semantically understand moved/inserted pages. Scanned images need OCR for text comparison.

## Security / lifecycle
- No PDF bytes or OCR content sent to Supabase or external document-processing services.
- Same-origin model assets are cached lazily (not included in install-time PWA precache to protect users' bandwidth and storage).
- Tesseract workers and PDF.js document handles are released after processing; OCR can be aborted.
- Existing 23 tools, form editor and account preference sync are preserved.
- No new backend or Supabase database requirements.

## Tests and verification
- Unit tests for TSV word boxes, confidence filtering, text normalization and pixel difference masks.
- Browser tests for comparison and exports, OCR skip-existing path, and real image-only OCR to validated searchable PDF.
- Blocking npm audit, typecheck, lint, unit/build, Chromium/Firefox/WebKit tests, GitHub Pages deploy and live PDF export smoke test.

## Limitations / potential follow-ups
- Advanced OCR on rotated pages, advanced layout analysis, Bengali fonts and CJK searchable text overlays require a Unicode-capable font and coordinate transform validation; no claims made for these yet.
- Fine-grained text diff alignment, multi-version compare, and semantic revision summary are deferred.
