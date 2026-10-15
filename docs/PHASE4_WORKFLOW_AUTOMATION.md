# Phase 4 — Workflow builder and reusable local presets

## Overview

The DocFlow Workflow builder is a **new batch-category tool**. It chains already-tested local PDF worker operations, one file and one step at a time. It does not introduce a cloud document-processing API.

### Supported workflow steps

- Rotate pages (all, odd, even or selection)
- Add page numbers (format and placement options)
- Text watermark (opacity, rotation and font size)
- Crop visible area (CropBox only; **not secure redaction**)
- Edit or clear standard PDF Info properties (**not XMP sanitisation**)
- Remove selected pages (destructive to the *exported copy*, original untouched)
- Optimise supported JPEG images (potentially lossy; other image/vector content not claimed to be recompressed)

The editor permits **1–8 ordered steps**, with parameter editing, accessible Move up / Move down / Remove controls, and validation before running. Operations with multiple outputs, irreversible signatures, OCR and passwords are deliberately excluded from the first chaining engine because they need different intermediate-file and secret-handling contracts. All existing tools remain separately available.

### Queue and results

- Up to 20 PDFs; max 50 MB per file and 150 MB total.
- Sequential files and sequential worker steps. Each intermediate PDF becomes the next step's input.
- Per-step/per-file status and overall percentage; cancellation terminates the current PDF worker and stops subsequent files.
- Failed files stop at their first failed step; the rest of the batch continues. **Retry failed** restarts each affected file from its original source using the recipe that ran (never an intermediate document).
- Completed individual PDFs are downloadable; prepare ZIP packages only successful outputs. Unique filenames include the queue index.
- A reload or workspace close discards input file references and processing results. Files and output bytes are never saved in persistent storage.

### Presets

- Two starter presets, Prepare for sharing and Internal review copy.
- Explicit Save on this device, Load, Update and Delete actions; up to 15 custom recipes.
- Only whitelisted operation IDs and options are persisted in localStorage. Unknown options, unsupported operations, excessive steps and invalid or duplicate IDs are rejected/ignored.
- **Important**: a saved preset may include entered watermark text or metadata values. The UI warns against using sensitive presets on shared devices. PDF bytes, filenames, PDF passwords, signatures and OCR data are never saved as part of a recipe.
- Recipes are local to each browser/device, not part of Supabase preference sync.

### Architecture

- `src/workflows/workflowEngine.ts`: typed recipe schema, validation, preset limits, sequential one-output PDF contract, cancellation boundaries, progress events.
- `src/tools/workflowWorkspace.ts`: accessible builder and local queue UI; reuses existing `runWorkerOperation`, standard `jszip` and localStorage only for approved presets.
- `src/styles/workflows.css`: responsive builder layout.
- No new Supabase tables, servers or API keys.

## Release checks

- Unit tests: step chaining, strict schema, option sanitisation, cancellation, error stops, storage failure handling.
- E2E: real PDF exports and ZIP, browser-local saved preset lifecycle, partial failure + retry from original, small-screen operation controls.
- Mandatory dependency audit, typecheck, lint, existing unit tests, build, full Chromium/Firefox/WebKit regression suites, GitHub Pages deployment and live PDF operation tests.

## Future directions

True multi-output DAG workflows, OCR chain steps, advanced visual workflow debugging, optional preset cloud sync (separate explicit consent and database policy), conditional branches, and encrypted local recovery may be added later. This release makes no claims to implement those features.
