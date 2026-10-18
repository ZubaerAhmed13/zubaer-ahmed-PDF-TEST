# R6 · v0.8.0 — repeat jobs and export review

R6 extends the existing workflow, batch, session and download surfaces. All 29 tools remain; documents and job results remain in this tab. There are no new services, runtime dependencies, cloud payload fields or automatic recipe saves.

## Repeatable workflows

The workflow builder supports versioned local JSON recipe export/import. The envelope is `docflow-workflow`, version 1. Import validates a 64 KiB maximum, identifiers, operation/option whitelist, ranges, enum values, numeric bounds and the existing eight-step limit. Future versions and unsupported operations fail visibly. Existing opt-in v1 local presets remain readable. Import changes the draft only; Save is still required for persistence. Exports contain recipe configuration, including any watermark/property text; review it before sharing.

Check workflow is a sequential, cancellable dry run. It inventories the source locally, simulates page-count and crop-box changes, validates later ranges against the current intermediate PDF, checks watermark font encoding and lists each step’s preservation consequences. Run repeats that preflight for each source before changing its working copy. A failed file does not suppress successful files. Preflight predicts supported configuration/geometry problems; it does not guarantee arbitrary PDF decoding or a later memory-dependent operation will succeed.

Keep selected pages reuses the already-tested extract-pages worker. Watermark steps now support ranges. A range always refers to the current PDF at that step. All/odd/even rotation ignores an inactive selected-page range, matching its execution engine. The workflow keeps the existing operations’ rendering and preservation limits.

Naming supports `{name}`, `{index}` and `{recipe}` with sanitisation and collision suffixes. Each retry uses its original File and the executed recipe/naming snapshot, even after the draft changes. Selected retry excludes new pending files. Completed outputs survive draft edits and partial failures. Run starts a new job; retry never starts at an intermediate PDF. Batch adds the same preflight approach and per-file retries using executed settings. Workflow and batch admit at most 20 files, 50 MiB each and 150 MiB combined, with a 150 MiB retained-output budget; workflow intermediate PDFs also respect 50 MiB. Existing worker deadlines and concurrency limits apply.

## Export review and continuation

Output links retain their existing downloads and add an explicit Review export panel with format, exact byte count, filename, operation consequences and PDF preview/compare/continue controls. File sharing uses the same bytes and current filename. Batch/workflow collision-safe renames update future ZIP entries; previously prepared ZIPs are invalidated and must be rebuilt. ZIP generation locks the source/configuration controls and cancelled or disposed generation cannot publish.

Compare captures the original File when the result is created; selecting a later source cannot retarget an older result. Continue validates and adopts the selected result once, then opens the shared reader. It never repeats the originating operation. The existing Next tool selector then reuses that working copy for another task. Secure-redaction adoption retains its history-clearing barrier. Protected PDFs remain download-only until unlocked. Previewing or comparing does not automatically adopt a result. Source identity uses File snapshots rather than filenames, including equal-named inputs.

The workflow includes local help for sharing, review and shorter submissions. The general export summaries describe representation/preservation limits; they do not validate signatures, scan malware or certify PDF/A/PDF/UA.

## Conditional roadmap boundaries

OCR remains the separately reviewed PDF + recognition-report flow. No OCR chain is advertised without a defined multi-output/report retention contract. Use Continue and Next tool → OCR to review it explicitly. Bookmark editing, page-label editing and insert/replace pages remain outside this release: R5 established catalog losses on page-copy paths, so preservation for those new edits has not been proven. Existing reader outlines and labels remain available.

## Verification

The release PR records exact-SHA unit, browser and production evidence. Tests cover recipe round trips, hostile/oversize/versioned input, intermediate ranges, cumulative crops, signatures/actions, actual repeated page geometry and selected-page watermark text. Browser journeys cover portable dry runs, executed-recipe retries, source replacement, result handoff, mobile accessibility, rename/ZIP invalidation and delayed import. Existing R1–R5 export, offline, encryption, redaction, large-document and cleanup suites remain release gates.

Author-side checks cannot run Playwright here because the browser download endpoint returned an invalid archive. GitHub’s full Chromium/Firefox/WebKit matrix and exact-main production suite are required before release. Physical-device, manual assistive-technology and Safari offline execution remain unverified. Repeat recipes promise repeatable supported transformations, not universally byte-identical PDF files or arbitrary document compatibility. Export before closing or reloading the tab.

The merged-build Firefox run exposed a delayed form-discovery race while Advanced JSON was being edited. Initialization now preserves focused selections and already-touched JSON, with a deferred real-worker browser regression and unit reproductions. The corrected build must pass the full release gates before final sign-off.
