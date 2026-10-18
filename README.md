# DocFlow Professional

A local-first PDF workspace with 29 tools, built with TypeScript/Vite. PDF processing stays in the browser. Optional Supabase accounts synchronise favourite/recent tool IDs only.

Production: https://zubaerahmed13.github.io/zubaer-ahmed-PDF-TEST/

## Current release

**A1.1 / v0.10.0** begins the advanced programme with editable PDF region highlights in the existing editor. The [release record](docs/A1_1_RELEASE.md) and [engine decision](docs/A1_FEASIBILITY.md) define its tested scope. All 29 tools and browser-local processing remain.

- Add native highlights with review comments; reopen supported highlights to move, resize, recolor, duplicate or delete them, with undo/redo.
- Keep the existing baked-in highlight option. Neither highlight option removes original content.
- Keep unsupported highlights unchanged and show a clear notice; preserve searchable original text on the native-highlight path.
- No new dependency, remote processing, application license or hosting change.

Earlier releases: [R7 product finish](docs/R7_RELEASE.md), [R6 repeat work and exports](docs/R6_RELEASE.md), [R5 preservation/safety](docs/R5_RELEASE.md), [R4 OCR/photos/comparison](docs/R4_RELEASE.md), [R3 mobile/offline](docs/R3_RELEASE.md), [R2 editing/reader/forms](docs/R2_RELEASE.md), [R1 document session](docs/R1_RELEASE.md), [R0 baseline](docs/R0_RELEASE.md).

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

## R5 preservation and safety

Version 0.7.0 adds local document/signature/action inspection, per-tool export consequences, redaction resolution and exact-size preview, bounded rendering/workers and reproducible release artifacts. See [R5 evidence and limits](docs/R5_RELEASE.md) and [application licensing status](LICENSE_STATUS.md). All 29 tools and prior offline/local-processing boundaries remain.

## R6 repeat jobs and exports

Version 0.8.0 adds portable local workflow recipes, page-aware preflight, selected retries using executed settings, naming patterns and common export review. Preview, compare or continue with an exact result in the shared document session. [R6 behavior and verification boundaries](docs/R6_RELEASE.md).
