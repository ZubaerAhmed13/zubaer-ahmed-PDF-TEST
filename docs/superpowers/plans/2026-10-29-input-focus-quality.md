# Input and focus quality implementation plan

> Execute inline under the user's standing instruction to finish the roadmap and continue improvements.

**Goal:** Reject files beyond the existing resource budget before reading bytes, preserve keyboard focus and caret selection during native-content repaint, and prevent stale navigation from replacing newer browser history.

**Architecture:** Reuse `validateInputBudget` before modifying v2 session state. Capture source-panel/overlay focus by stable control/object identity, restore it only while the source editor owns focus, and retain the requested hash across asynchronous preview teardown.

**Spec:** Existing improvement backlog in `docs/DELIVERY_PROGRESS.md`; restore the previously uncommitted slice lost during workspace maintenance.

- [ ] Add browser regressions for 151 MB rejection without reading, combined 250 MB rejection retaining accepted files, keyboard selection/validation, and backward caret preservation.
- [ ] Observe failures before implementation; implement in `src/v2/app.ts` and `src/v2/nativeEditor.ts`.
- [ ] Exercise rapid Back/Forward while preview teardown is pending; guard the actual requested hash as well as the navigation generation.
- [ ] Run the affected browser journeys, unit suite, typecheck, lint and build. Record local Chromium version separately from CI's pinned browser.
- [ ] Obtain a fresh read-only review, publish the exact verified tree to draft PR #36, and continue the next missing adapter.

Review focus: validation must precede buffer reads and session mutation; failed additions keep accepted files; a user who moves to zoom retains focus; selection ranges/direction survive; obsolete navigation cannot canonicalize a newer URL. Probe overlapping cancellation separately if reproducible.
