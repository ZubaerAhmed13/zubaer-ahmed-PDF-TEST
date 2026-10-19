# Upgrade ledger — docs/superpowers/plans/2026-10-19-page-journey.md

Base: 94253ee85ac013abf8876b58e5e4fa8ce6702a7b. Fresh clone, feature branch feat/docflow-page-journey; no pre-existing user edits.

User explicitly authorised implementation after the research proposal. Execute inline; one independent whole-branch review at the end.

Pre-flight: Tasks 1→2 share PageRoute/PageResults; Task 2→3 share page controller and scoped CSS. Keep state separate from presentation. Existing workspace/runtime lifecycle remains the PDF authority.

Scope decision: ship the complete 29-tool UI journey first. Backend is permitted, but introducing new OCR/Office engines is a separate measured capability change, not required to make navigation work. Cost if wrong: an additional capability release rather than an unbenchmarked server service.

Baseline: dependencies installed; all 138 existing unit tests pass.

Task 1: complete — 5309853; route/result tests failed before modules existed, then all 143 unit tests passed. Result identity, stale tokens, safe names and budget covered.

Environment: pinned Playwright 1.62 browser archive was unavailable locally. Downloaded a separate compatible Chrome 141 headless binary using temporary Playwright 1.56 tooling; no runtime dependencies changed. Optional DOCFLOW_TEST_CHROMIUM enables local verification, CI retains its normal pinned browser configuration.

Task 2 RED: direct-link browser journey failed because the old app had no dedicated upload page. Integration underway. First export fixture used text wider than its default box; shortened the fixture text after the real PDF engine correctly refused overflow.

Tasks 2/3 integration: dedicated tool/upload/result pages now cover all 29 IDs, with Back/Forward guards, retained editor state, exact-byte results, safe rename, export consequences and phone panels. Core 15 Chromium journeys passed, including the new five journeys and all native-highlight/document-session cases. All 143 unit tests, typecheck and lint pass.

Regressions found and corrected: nonmodal region must omit aria-modal entirely; inactive step contrast increased; rejected tool switching refreshes the session dropdown; hidden direct editors do not redraw at zero width; source/result lifetime remains in memory only. Direct editor vertical layout was first tested RED (canvas at y=832), then compacted and verified GREEN (canvas begins before y=500). Desktop/phone screenshots inspected.

Current verification: migrating modal-specific/inline-download assumptions in the full existing browser corpus to explicit page navigation and Return to editing. PDF structure/content assertions remain. Some broad-run failures reflect the pre-migration test snapshot; do not claim complete regression acceptance until a fresh final run passes.

Final review: independent fresh-context review of base..9cd0499 found three Important issues and no Critical or actionable minor issues. One fix pass:
- Archive rename removed its own ZIP through constituent-output invalidation. New batch and workflow page tests both failed RED, then passed GREEN after scoping invalidation to child outputs.
- Phone Options hid operation progress/errors. New closed-Options invalid-range test failed RED, then passed GREEN after moving the real status/progress/error component into the always-visible export footer.
- Result pages hid qpdf recovery warnings. Both damaged-repair fixtures failed RED on default result warning visibility, then passed GREEN after carrying real warnings and operation details to results.
Targeted fix acceptance: 5/5 Chromium browser tests passed. Final full-suite run follows. No review minors deferred; no review findings declined. Existing physical-device/keyboard/screen-reader acceptance remains unverified.

Additional regression corrections: explicit Return to editing in advanced export-review tests; scope settings menu and ZIP selectors; respect leave confirmation when testing recovery. A stale busy presentation attribute is reset on tool remount; test helper waits for processing to settle without assuming every busy operation produces an export (preview/undo do not).
