# Native source editing acceptance — 22 October 2026

This stage adds actual PDF object mutation through pinned @embedpdf/pdfium 2.15.1. It does not establish Acrobat feature parity or a world-class quality claim. The v2 draft remains unmerged while seven adapters and broader release acceptance remain open.

## Implemented contract

Select supported original text or an image, replace or remove it, preview the resulting PDF bytes, undo/redo with additions, and download a new copy. A SHA-256 binds all original page/object IDs to immutable input. Text is independently reopened before output is returned. An invalid later change never returns a partially modified PDF.

Original standard Helvetica/Times/Courier fonts accept tested ASCII; other source fonts conservatively use their existing character repertoire. An explicit DocFlow Sans choice permits covered Latin, Greek and Cyrillic characters and previews the changed appearance. One-line editing is supported; paragraph reflow and complex shaping/bidi are not.

Nested groups, marked content, all detected clipping (including inherited text clips), invisible/stroked/rotated text, image graphics transparency/blending, unreliable character mappings and signed/certified sources are guarded. Changing a text font with transparency/blend effects is also guarded. Removal is not secure redaction. Unsupported files remain unchanged.

Limits: 150 MB/file, 250 MB combined input, 1,000 changes, 16 MB complete serialized edit plan, 64 MB decoded replacement pixels, 16 million pixels/8,192 per image side, and the existing 120-second cancellable worker deadline. PNG/JPEG dimensions are checked before decoding. SDK and full PDFium third-party notices are shipped; the source-font sfnt is reconstructed deterministically from the existing licensed WOFF.

## Evidence

- 30 deterministic corpus documents: 26 supported invoices/CVs/reports/forms across all page rotations, crop boxes, standard/full/subset embedded fonts; four guarded grouped/clipped/marked/signed cases.
- Independent PDF.js extraction verifies selectable replacement text and absence of replaced text. pdf-lib verifies tested page geometry, notes, links, editable field values, author and title.
- PyMuPDF 1.26.6 renders all 26 supported before/after pairs: visible text changes; every pixel outside the union of the old/new text regions is identical (three-point antialiasing margin).
- Shared-image regression checks actual saved RGB pixels and PDF.js paint references: the replacement is used once; the other image occurrence retains its original dimensions. Additional opacity, blend, marked-image and inherited text-clip cases reject safely.
- Review reproduced five defects: text clipping loss, image opacity loss, tagged-image association loss, rejected-plan export leakage and page-change validation lock. Failing regressions were added, all five fixed, and a fresh reviewer independently verified the fixes.
- Browser cases cover actual canvas changes and downloads, mixed additions, original-font errors and explicit substitution, shared-image replacement, pending-text export guard, navigation retention, shared undo/redo, and cancellation when changing pages.

Local synthetic benchmark (Node 24.19.0/Linux x64, includes fixture generation and independent checks): median 30 ms, p95 403 ms, maximum 529 ms. These small-fixture timings are not production, phone or large-document latency claims. The PDFium WASM is approximately 4.5 MB; its worker engine is loaded on demand. The generated source font is 132 KB.

Run `npm test`, `node scripts/benchmark-native-content.mjs`, then `python scripts/verify-native-corpus.py`. Browser suite: `npx playwright test e2e/v2-*.spec.ts`. CI independently runs the raster verification and all v2 scenarios in Chromium/Firefox/WebKit. Current test totals and CI status are recorded in delivery progress after verification.

## Remaining acceptance

Real user documents, physical iOS/Safari and Android, assistive-technology operation, large-image memory stress, output review in additional desktop viewers, paragraph/reflow requirements, complex graphics and universal font handling remain separate acceptance work. The legacy full-browser suite still needs migration to the new shell. Production deployment remains gated by v2 parity and full release checks.

Continue next with issue #38's processing backend and benchmarked job lifecycle, then the seven missing v2 adapters, full release verification/deployment and subsequent evidence-based improvement rounds.
