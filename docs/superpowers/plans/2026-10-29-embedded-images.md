# Embedded-image extraction implementation plan

> Execute inline using the established v2 tool-per-page workflow and existing proven PDF.js domain engine.

**Goal:** Activate Extract images with visual review, individual PNG downloads, a ZIP and a truthful manifest.

**Architecture:** Move the legacy engine into `src/pdf/embeddedImages.ts`; retain the old view as a caller. Connect it to v2 execution and a separate image review module that decodes only the currently selected PNG. Each page exports each supported XObject once. Report skipped raster operations instead of silently presenting incomplete results as complete. Do not claim original compressed stream preservation.

**Spec:** Missing-adapter requirement in `docs/DELIVERY_PROGRESS.md`; iLovePDF-style upload → work visually → download journey.

## Constraints and review focus

Reuse the existing 150 MB input/output-image budget, 16 MP and 8,192-pixel per-image limits, safe PDF parser and cancellation scope. Bound result object count at 1,000. Masks/vectors are not page screenshots or ordinary embedded images. Preserve PDF originals. A malformed/unsupported raster is explicitly reported; resource-limit failure fails the operation. Repeated/shared PDF.js object caches, grouped inline images, transparency, cancellation and URL cleanup need scrutiny.

## Task 1: Real extraction and review

- [ ] Write and observe failing v2 tests: same 2×2 raster reused on two pages (once per page), pixel-equivalent PNGs/manifest/ZIP, individual download and review navigation; text/vector-only document yields an actionable error; cancelling before bytes finish never publishes a result.
- [ ] Extract `extractEmbeddedImages(buffer,onProgress,isCancelled)` into the domain module returning ZIP blob, count, image records/PNG blobs and skipped records. Keep legacy call compatibility.
- [ ] Handle repeated XObjects; report unsupported grouped-inline/mask raster operations, missing objects and unsupported decoded layouts. Resolve both common/page object caches; abort pending image resolution. Retain original image dimensions and transparency.
- [ ] Add `mountImageReview(host,data)` with labelled select/previous/next, page/dimensions, one current preview and individual download; revoke its URL on selection change and disposal.
- [ ] Activate the catalog/execute adapter and honest technical scope. Run targeted extraction tests, all v2 Chromium cases, units, lint/typecheck/build; fresh read-only review, address proven important defects, then publish exact verified tree.

## Ledger

Ruling: grouped inline atlas images are reported as skipped for this slice rather than exporting the combined atlas as one source image; extraction of their individual cropped source records needs a separate pixel-verified implementation.

Task 1: complete. Initial three adapter tests failed while unavailable; five extraction journeys now pass, plus all 47 v2 Chromium journeys and 200 units. Typecheck, lint, build (browser server) and provenance pass. Fresh review identified native-dimension resampling, navigation URL retention and legacy incomplete-output copy. Native-limit and URL-load regressions were observed failing, then pass with their fixes; legacy copy is typechecked. Current UI preview uses one URL, reserves intrinsic aspect ratio and is visually inspected. Publish this verified slice before reader work.
