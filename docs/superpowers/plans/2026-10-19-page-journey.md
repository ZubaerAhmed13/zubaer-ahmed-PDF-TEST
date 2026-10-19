# DocFlow Page Journey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship dedicated responsive tool and result pages across the existing 29-tool product.
**Architecture:** A small hash router and page controller wrap existing workspace/session owners. Explicit lifecycle/output callbacks feed a bounded result store; editor mounts survive a result-page round trip.
**Tech Stack:** Existing TypeScript/Vite, pdf-lib/PDF.js/qpdf/Tesseract, Vitest and Playwright.
**Spec:** `docs/superpowers/specs/2026-10-19-page-journey-design.md`

## Global Constraints
- Preserve all 29 stable tool IDs, engines and local/session/export correctness.
- No runtime dependency or hosting change; backend permitted for a justified separate capability increment.
- No filenames, document content or credentials in routes. Result bytes are transient.
- Browser Back/Forward and tool changes retain existing leave/cancellation guards.
- English, coral/navy identity, reduced motion and reachable 44px primary touch controls.

## Review Focus
- Rejected browser Back must preserve both the current document and usable history.
- Rapid tool changes and late disposed outputs must not overwrite the current page.
- Duplicate names, multi-output batches and renames must map to the correct bytes.
- Returning from results must keep editor objects/settings without rerunning the operation.
- Expired result routes and mobile keyboard/short viewports must provide usable recovery/actions.

### Task 1: Route and result ownership
**Files:** create `src/app/pageRoutes.ts`, `src/app/pageResults.ts`, `tests/pageJourney.test.ts`.
**Interfaces:** `parsePageRoute(hash, ids): PageRoute`; `pageRouteHash(route): string`; `PageResults` owns opaque IDs, output records, rename/invalidation and byte budget.
- [ ] Write failing route/result tests for stable IDs, malformed routes, distinct same-name outputs, invalidation, and budget refusal.
- [ ] Run `npm test -- tests/pageJourney.test.ts`; observe the missing behavior.
- [ ] Implement the small route/result models, including explicit URL cleanup ownership.
- [ ] Run targeted tests and the full unit suite; commit.

### Task 2: Full-page workspace and output handoff
**Files:** create `src/app/pageJourney.ts`, `src/styles/page-journey.css`, `e2e/page-journey.spec.ts`; modify `src/app/createApp.ts`, `src/app/documentWorkspace.ts`, `src/app/exportReview.ts`, `src/main.ts`.
**Interfaces:** page controller consumes existing tool IDs, guarded `openTool`, source/busy/change callbacks, and generated output events. It preserves the mounted editor for result/return.
- [ ] Write browser journeys for direct links, native PDF export → results → rename/download → return, Back cancellation, expired link and phone layout.
- [ ] Run the new Chromium spec; verify failures before implementation.
- [ ] Add nonmodal page presentation, guarded history, upload entry, exact-byte output capture and dedicated result actions.
- [ ] Run new journeys plus document-session/editing/export regressions; migrate public modal/result assumptions as needed, preserving PDF assertions.
- [ ] Commit.

### Task 3: Discovery and responsive polish
**Files:** modify `src/app/createApp.ts`, `src/styles/page-journey.css`, targeted discovery/design/browser tests.
**Interfaces:** homepage tool actions use the same page controller; mobile panels are presentation state only.
- [ ] Add assertions for early phone search, settings menu, no shell overflow, and all-tool page loading.
- [ ] Run and observe unmet layout/navigation assertions.
- [ ] Implement compact hero/search/popular tools, organised menu and desktop/phone page layouts.
- [ ] Run targeted browser/axe checks and inspect desktop/phone screenshots; commit.

### Task 4: Release verification and review
**Files:** update version, README, capability/release documentation and production selection where required.
- [ ] Run audit/provenance/typecheck/lint/full units/build and complete browser matrix.
- [ ] Request one independent whole-branch review, then reproduce/fix consequential findings with regressions.
- [ ] Verify release artifact and keep exact-SHA evidence; push feature branch and open a concrete reviewable PR.
- [ ] Record completed scope, actual checks and remaining backend/device acceptance without claiming unexecuted work.
