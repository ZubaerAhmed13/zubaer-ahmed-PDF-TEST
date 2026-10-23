# Native PDF Content Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Select, replace and remove existing PDF text/image objects and export independently verified PDF bytes.
**Architecture:** A lazy PDFium worker changes native objects in the immutable original. A fingerprinted edit plan shares existing history; preview and export consume the same engine output, with additions applied afterward.
**Tech Stack:** TypeScript, pinned @embedpdf/pdfium 2.15.1, existing PDF.js/pdf-lib/fontkit, Vitest and Playwright.
**Spec:** docs/superpowers/specs/2026-10-22-native-content.md

## Global Constraints

- 150 MB/file, 250 MB combined, 1,000 native edits, existing 16 MB plan budget, 120-second worker deadline.
- Native images: at most 16 million decoded pixels / 8,192 pixels per dimension.
- Keep source bytes immutable; reject stale/unsupported edits, signed/certified sources and implicit font substitutions.
- Preserve all 22 current adapters and existing additions/history tests. No simulated editing or raster/white-cover substitution.
- Bundle source-engine/font notices; all npm dependency versions remain exact pins.

## Review Focus

- Shared image resources must change only the intended occurrence.
- Partial mutation followed by a rejected edit must never return partial output.
- Native text, byte arrays and source dimensions must not bypass worker/plan budgets.
- A late preview must not replace another source or undo state.
- Unsupported fonts, nested forms or clipping must be visible and leave the input untouched.

### Task 1: Actual object engine and deterministic assets

Files: new src/pdf/nativeModel.ts, src/pdf/nativePdfium.ts, scripts/stage-native-assets.mjs; package scripts/pin and public licences; tests/nativePdfium.test.ts and tests/nativeAssets.test.ts.
Interfaces: createNativePdfium(wasmBinary:Uint8Array):Promise<NativePdfium>; engine.inspect(source:Uint8Array,page:number,frame:PageFrame):Promise<NativeInspection>; engine.apply(source:Uint8Array,plan:ResolvedNativePlan,frames:PageFrame[],font?:Uint8Array):Promise<Uint8Array>.
- [x] Write real PDF fixtures and failing tests for text replacement/old-text absence, unchanged other content, stale fingerprint/invalid IDs, actual image pixels and unchanged shared use.
- [x] Run npm test -- tests/nativePdfium.test.ts --maxWorkers=1 --testTimeout=20000. Missing module failure confirmed.
- [x] Implement object validation, allocation ownership, non-incremental save and font/image edits; stage deterministic sfnt from the existing WOFF, and include all SDK notices.
- [x] Run focused tests (7), all units (152), typecheck, lint and provenance. All pass. Saved text is reopened before the engine returns output.
- [x] Commit the engine and evidence (2aa25b0 locally).

### Task 2: Worker adapter and unified editor/preview

Files: new src/pdf/nativeEditing.ts, src/v2/nativeEditor.ts; modify worker operation types/handlers, EditPlan, EditorDraft, pageEditor.ts, app.ts, styles.css and catalog.ts; e2e/v2-native-content.spec.ts.
Interfaces: NativeEditPlan is optional EditPlan.source; native-edit-inspect returns JSON NativeInspection; applyEditorChanges(files,options,emit) applies source changes then current additions. V2NativeEditor commits a NativeEditPlan through existing EditHistory. App regenerates preview bytes from source changes with generation guards; export uses that same plan.
- [x] Add failing browser tests for editing original selectable text, replacing an image, actual PDF preview, mixed additions, native Undo/Redo, pending input across Back/Forward and cancellation.
- [x] Implement the adapter and UI, lazy engine/font fetch, explicit font substitution, per-page source selection, unsupported-case messages and bounded image decoding.
- [x] Run the new browser cases plus existing v2 cases, all units, typecheck/lint/build: 191 units and 38 Chromium cases passed. Review regressions and safe error explanations verified separately.
- [ ] Commit the usable editor.

### Task 3: Corpus and preservation acceptance

Files: tests/nativeContentCorpus.test.ts, scripts/benchmark-native-content.mjs, docs/NATIVE_CONTENT_ACCEPTANCE.md, relevant fixture helpers.
Interfaces: reuse Task 1 engine with actual generated PDF sources; never mock PDFium or the independent verifier.
- [x] Add a 30-case corpus with invoices/CVs/reports/forms, crop and all four rotations, embedded/subset Latin/Greek/Cyrillic fonts, plus shared-image and guarded graphics-state regressions. Unsupported image effects are guarded rather than silently lost.
- [x] Run the corpus and independent extraction/render/preservation checks: 30 cases pass, 26 supported raster pairs preserve unrelated pixels.
- [x] Record supported/rejected classes, timings and remaining real-document/device acceptance; correct important defects with failing regression checks.
- [ ] Commit the acceptance record.

### Task 4: Review, publish and advance

- [x] Use a fresh review against the spec and the whole stage diff; all five important findings resolved and independently rechecked.
- [ ] Publish into the existing v2 draft with an expected-head guard and verify Chromium/Firefox/WebKit CI.
- [ ] Update docs/DELIVERY_PROGRESS.md and issue/PR evidence accurately.
- [ ] Continue immediately to the processing backend stage, then missing adapters and final release validation. A deployment is a milestone, not a stopping condition.
