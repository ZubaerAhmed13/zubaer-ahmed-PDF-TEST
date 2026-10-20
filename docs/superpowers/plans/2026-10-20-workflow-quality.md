# DocFlow 2.0 Workflow Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the existing v2 edit/export journey safe and visually dependable, with visual organisation and meaningful compression controls.

**Architecture:** Keep durable drafts outside disposable page views. Keep the tested PDF workers as the processing boundary. Share the export font and point-based geometry with the preview; use accessible search/options components rather than navigation for transient controls.

**Tech Stack:** TypeScript, PDF.js, pdf-lib/fontkit, existing worker operations, Playwright, Vitest; no new product dependencies.

**Spec:** `docs/superpowers/specs/2026-10-20-workflow-quality.md`

## Global Constraints

- Keep all existing v2 tool adapters and real output bytes.
- Never retain passwords in saved options or browser storage.
- No public deployment or claim of original-PDF-text replacement.
- Keep keyboard/button alternatives to drag; test phone and desktop.

## Review Focus

- Replacing files or changing tools during async preview must not resurrect stale files/edits.
- Returning to a draft and editing again must invalidate the old output.
- Password inputs must be excluded from session snapshots.
- A long line that export rejects must be visibly flagged in the preview.
- Repeated organiser pages and no-op compression must retain correct byte downloads.

### Task 1: Draft and navigation ownership

Files: `src/v2/app.ts`, `src/v2/pageEditor.ts`, `src/v2/pageOrganizer.ts`, new `src/v2/draft.ts`, new `src/v2/toolSearch.ts`; test `e2e/v2-workflow-quality.spec.ts`.

Interfaces: app owns an `EditorDraft` with a shared `EditHistory`, retained non-password option values and an `OrganizerDraft`; views mount/dispose without clearing them. `mountToolSearch(host,onChoose)` handles focus, search and dismissal without hash changes.

- [x] Add browser tests proving edit→export→Back retains additions/history and options; opening/closing search preserves source/edits.
- [x] Watch tests fail on the current production build.
- [x] Implement draft ownership, explicit Return to editing, guarded reset/source/tool replacement and non-destructive search. Password fields are always excluded.
- [x] Run the focused browser cases and session-related existing v2 tests.

### Task 2: Truthful preview and reachable phone controls

Files: `src/v2/pageEditor.ts`, `src/v2/app.ts`, `src/v2/styles.css`, `index.html`; tests in `e2e/v2-workflow-quality.spec.ts`.

Interfaces: editor uses the same `DocFlowSans` font and PDF-point coordinate scale as `directEdit.ts`. App owns zoom mode and mounts a non-modal options panel with a dismiss control.

- [x] Add failing checks for changing font size, actual phone zoom, landscape action position and Escape/focus restoration.
- [x] Implement shared-font preview, explicit-line rendering/overflow feedback, fit/zoom viewports, height-aware layouts and options dismissal.
- [x] Run focused cases and existing editor/browser output tests; inspect screenshots at 390/844/1440 widths.

### Task 3: Visual organisation and processing depth

Files: `src/v2/pageOrganizer.ts`, `src/v2/app.ts`, `src/v2/styles.css`, new `src/v2/compression.ts`; tests in `e2e/v2-workflow-quality.spec.ts`, `tests/v2Compression.test.ts`.

Interfaces: organiser takes a retained draft plus a preview renderer, exposes `getOrder()` for the existing worker. Compression helper maps presets/advanced options into existing `imageQuality`/`maxImageDimension` options and derives an honest result summary from worker metadata.

- [x] Add tests for reordered thumbnail exports, returned page order, controls wired to output metadata and no-op result explanations.
- [x] Watch failures; implement thumbnail ordering, bounded rendering, drag/buttons, advanced settings and result summaries/warnings.
- [x] Verify actual PDF page order, image recompression metadata, returned settings and preserved text.

### Task 4: Review and deliver

Files: branch changes above and `docs/V2_WORKFLOW_QUALITY.md`.

- [x] Run all unit tests, typecheck, lint, production build and the v2 browser suite with actual downloads.
- [x] Review the entire diff in fresh context; correct important findings and re-run affected verification.
- [x] Document measured results and the original-object/backend evaluation boundary.
- [x] Commit and publish reviewable changes to GitHub; retain the v2 draft release boundary.
