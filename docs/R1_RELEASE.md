# R1 — one document across tools (0.3.0)

## Scope and everyday workflow

Choose Open a PDF to begin a document session. Tool-card workflows can join with Keep working with this PDF. Choose the next tool in the shared toolbar; the current File is supplied directly without download/reimport. Run a tool, review its result, choose Use result, then continue. Export current PDF downloads the applied revision with an editable filename. Closing a tool leaves Resume document on the home page. Closing/reloading the tab ends the session.

Original, current and pending-result previews are distinct. Undo/redo switches immutable applied revisions, not tool settings. A new edit after Undo drops the redo branch. Up to eight revisions plus the starting file are retained, subject to the documented memory budget. New document requires an explicit discard choice. Nothing in the session is persisted or uploaded.

## Critical boundaries

- Applied permanent redaction clears earlier session revisions and source previews. Its warning and action label explain this barrier before application; files on the device remain unchanged.
- Protected/encrypted outputs are download-only, so a password is never retained to make them silently editable. Split/batch/workflow PDF results require an explicit output selection.
- Existing preservation, OCR, comparison and raster-export limitations still apply to every step. A chain inherits its least-preserving operation.
- Active processing and unapplied edits have close/switch guards. PDF result validation is a brief atomic commit: leaving waits until that check finishes, with an explicit status. Late results from disposed tools cannot become a revision in a new tool.
- Update/retry/reload protects local work. A waiting service worker checks all same-scope tabs; retained work, active processing or an unresponsive older tab blocks activation. Finish/export/close that tab and try again.

## Architecture and evidence

The persistent toolbar and explicit workspace runtime/mount contracts replace whole-body structural discovery observers. Root-scoped asynchronous presentation reconciliation remains within the existing editors and is disposed with them. Existing visual identity, all 28 tool IDs, exports, workers and PDF engines remain.

Evidence: tests/documentSession.test.ts, tests/serviceWorkerUpdate.test.ts, e2e/document-session.spec.ts plus all existing regression suites. The full three-browser matrix and expanded deployed suite are release gates. Exact commit and successful run links belong in the merged PR's release record and the [Pages workflow](https://github.com/ZubaerAhmed13/zubaer-ahmed-PDF-TEST/actions/workflows/pages.yml); this file does not assert an unexecuted deployment result.

Physical iPhone/Android acceptance, manual screen-reader checks, real-account cloud preference acceptance, and GitHub Pages response framing-header limits remain open from R0. This release adds no cloud-document store, account requirement or new host.
