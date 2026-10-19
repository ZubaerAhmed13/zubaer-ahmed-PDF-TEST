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

Final follow-up: the full local Chromium run completed 136/143 with 7 failures. Five were remaining test contracts (explicit result/return, retained hash-route reload and leave confirmation), one was the hidden recovery notice, and one was the older browser's offline emulation. The five contract paths plus recovery/release/workflows passed in a fresh 23/23 targeted run. Recovery now emits an explicit readiness event and presents the actual saved-state notice on the upload page before source selection; existing recovery test observed RED then GREEN.

Organizer timing: a delayed source could install its initial page order while the user was selecting/replacing order text. Controlled file-read test failed RED while the field remained enabled. Disable only that field during source preparation, enable it when ready, and preserve generation cleanup. The new test exports requested page widths [302,300,300]; final organizer/journey/recovery group passes 13/13. Final typecheck/lint and all 143 unit tests pass.

Offline evidence: the compatible Chrome 141 allows service-worker requests during context.setOffline, confirmed with both matching Playwright 1.56 and project 1.62 drivers. An isolated production server was stopped completely; the uncached probe then rejected, and cached reload -> Edit PDF -> real export/download succeeded (5,132-byte one-page PDF). Pinned Chromium CI at remote a429a249 also passed the original prepared-mobile offline test. Do not weaken or skip that CI test.

CI a429a249: full quality job passed (audit/provenance/types/lint/units/build/reproducible archive/OCR benchmark). Chromium 136 passed, 5 failed on the now-corrected contract/recovery cases; two additional cases were retried. Final head matrix still required. No deployment/merge, backend-engine increment, or physical device/manual assistive-technology acceptance is claimed.

Cross-browser follow-up: c196423fec7ed2aa5dfd1c043f1e0b0ef44ac1f4 passed complete Chromium and Firefox CI plus the quality job. WebKit's retained report exposed two real page-integration problems: an update banner could intercept phone Run controls, and a router-started retry could be superseded by the old retry handler. The phone session test also checked for the asynchronously mounted Options pane too early; it now waits for the actual Options control.

Retry fix: gate the recovery chunk through two animation frames; the upload button stayed disabled (RED). When the URL already identifies the retry tool, consume its retry marker on that router-owned mount instead of dispatching a second open. The real picker becomes enabled (GREEN). Update fix: retain the real notification and its work-protection flow but prepend it in normal page flow. The production-worker drill now resumes a phone document, runs Rotate while an update is waiting, downloads via the default result page, and completes guarded update recovery. WebKit's overlay failure is recorded in its retained trace; the updated production drill passes locally.

Final verification on the latest source: 143/143 unit tests, typecheck, lint and 19/19 lifecycle/session/journey/update browser checks pass. The preceding broad compatible-Chromium sweep passed 142 tests; its one failure was the newly extended phone update drill before the final fix. Its original offline-emulation test was deliberately excluded from that local sweep; unchanged pinned CI and a truly disconnected-server drill already cover that boundary. Final-head full Chromium/Firefox/WebKit CI remains pending. Keep PR #24 draft and do not merge/deploy or claim Safari/physical-device acceptance until those gates complete.
