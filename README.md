# DocFlow Professional

A local-first PDF workspace with 29 tools, built with TypeScript/Vite. PDF processing stays in the browser. Optional Supabase accounts synchronise favourite/recent tool IDs only.

Production: https://zubaerahmed13.github.io/zubaer-ahmed-PDF-TEST/

## Current release
Package version and diagnostics share one build-time source; diagnostics also shows the exact Git commit supplied by the release runner.

R4 (0.6.0) adds OCR page ranges, mixed English/German recognition, rotation/deskew review and Unicode overlays; photo crop/perspective cleanup; matched-page comparison and navigable change reports; literal Markdown extraction. [R4 scope, measured OCR results and limits](docs/R4_RELEASE.md).

R3 (0.5.0) adds verified offline-asset setup, explicit English/German OCR downloads, mobile pan/select and non-drag controls, viewport/keyboard handling and capability-detected Save/share. Open **Offline & storage** or **Help & offline** to prepare this browser. [R3 scope and device acceptance](docs/R3_RELEASE.md).

R2 (0.4.0) adds direct page editing, visual crop handles, native sticky-note comments, Unicode added text, reader search/navigation, and on-page form controls. [R2 scope and evidence](docs/R2_RELEASE.md).

R1 (0.3.0) adds an optional in-memory document session: open once, switch tools, review/apply results, undo/redo revisions and export. Use **Open a PDF**, or **Keep working with this PDF** inside a tool. [R1 scope and evidence](docs/R1_RELEASE.md).

R0 (0.2.0) established current capability documentation, synthetic preservation/repair/redaction fixtures, all-page repair verification, broader production tests and least-privilege preferences. [R0 evidence](docs/R0_RELEASE.md) separates executed checks from pending acceptance.

## Tools
- View, merge, split, remove/extract/organise/rotate and crop pages.
- Numbering, text/image watermarks, baked-in annotations, drawn/typed visual signatures.
- Images to PDF, PDF to images and decoded embedded-image extraction.
- Supported visual AcroForm editing and flattening.
- Selectable-text search/export, English/German OCR, text/pixel PDF comparison.
- Document properties, local AES-256 protection/unlocking, selective JPEG optimisation.
- Bounded batches, local multi-step workflows, raster redaction and structural repair.

[Capability/evidence matrix](docs/CAPABILITIES.md) · [Preservation baseline](docs/R0_PRESERVATION_MATRIX.md)

## Boundaries
Visual signatures are not certificate signatures; existing page-text replacement is not implemented. Crop hides content; basic properties editing is not hidden-data sanitisation. Redaction rasterises all pages and removes source text/vectors/forms/tags/signatures. OCR processes selected ranges in chunks of up to 30 pages with English/German models and approximate Unicode placement. Comparison uses heuristic page matching and downscaled visuals, bounded to the first 50 pages per document; uncertain matches require review.

Page-copy operations do not guarantee bookmarks, attachments, labels or editable forms. Whole-file buffers are required; no arbitrary multi-gigabyte, print-proof colour or PDF/UA claim. Offline availability depends on cached assets and browser support. Real Safari/iOS offline acceptance is separate.

## Development
```bash
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

The release pipeline builds only dist, runs quality and Chromium/Firefox/WebKit, deploys to Pages and verifies representative real exports against the deployed URL.

[Architecture](ARCHITECTURE.md) · [Privacy](PRIVACY.md) · [Security](SECURITY.md) · [Testing](TESTING.md) · [Release gates](RELEASE_CHECKLIST.md) · [Cloud preferences](docs/SUPABASE_CLOUD_SYNC.md)

The September completion/parity documents are historical migration records. The locally vendored qpdf 12.3.2 runtime has licence/integrity provenance in src/vendor/qpdf. Structural paths do not intentionally rasterise source pages; optimisation/raster exports disclose their representation changes.
