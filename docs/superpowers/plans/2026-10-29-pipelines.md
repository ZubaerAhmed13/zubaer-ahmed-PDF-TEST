# Workflow and batch v2 delivery plan

Continue inline on the isolated rebuild branch after visual signing. The legacy implementation already has validated recipes, sequential chaining, preflight and recipe transfer. Preserve those domain modules; replace their legacy workspace controllers.

**Design:** A labelled step editor in the existing inspector, with add/remove/up/down actions and ordinary controls for eight supported workflow operations. Batch uses the same editor with one step and four supported operations. The file rail supports selecting each original for preview. A queue report shows checked/running/complete/failed/cancelled states, page counts and preservation warnings. Outputs can be reviewed as exact PDFs, downloaded separately or packaged into a ZIP. Only explicit Save stores recipe configuration; no documents or signatures enter local storage.

**Execution:** Validate File metadata before any read: 20 PDFs, 50 MB each, 150 MB total. Read one original at a time, preflight it, then run its validated steps with one active worker. Bound each PDF output to 50 MB and combined outputs to 150 MB. A failure does not stop independent files. Cancellation preserves completed outputs. Retry failed/cancelled entries with their previous immutable step snapshot, even after editing the current controls. Navigation cancels and generation-guards late work. New runs replace old results; queue changes invalidate prior execution.

- [x] Observe unavailable workflow/batch journeys failing before implementation; add meaningful orchestration regressions for sequential reads/workers, original-settings retry and partial cancellation.
- [x] Implement the bounded queue coordinator, step editor, explicit recipe save/import/export and exact-output queue review.
- [x] Connect both adapters to existing routes and processing controls without reading all input PDFs at once. Preserve drafts through Back/Forward and reject oversized additions before reading.
- [x] Verify actual chained output page order/rotation/text, failed-file isolation, cancellation/retry snapshots, duplicate names, ZIP contents and responsive/keyboard operation.
- [ ] Fresh read-only review; fix reproduced defects; all v2 Chromium, units/typecheck/lint/build/provenance and published-head three-browser CI.

Known limits: crop hides content rather than redacting it; page-copy operations lose document-level structures; image recompression can be lossy and need not shrink files. No server documents are accepted by this stage. Physical-device and manual assistive-technology acceptance remains open.
