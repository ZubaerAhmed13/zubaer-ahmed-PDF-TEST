# A1.1 · v0.10.0 — editable PDF region highlights

This first advanced-programme increment adds native region highlights to Edit PDF. It keeps all 29 tools, the existing baked-in Highlight region control, native sticky notes, local processing, transient documents, optional preference-only cloud accounts and GitHub Pages hosting.

## Behavior

Choose **Editable highlight** to place a region, move/resize it visually or through numeric properties, choose a color, and add a review comment. Export, reopen and continue editing supported marks; duplicate/copy, delete and command undo/redo use the existing edit model. The mark is a PDF Highlight annotation with QuadPoints and an explicit appearance, so an independent compatible viewer can edit it. Original page content remains searchable and is not rasterised or covered with a security claim.

Reimport supports a single rectangular visible region with supported color, opacity and flags. Multi-region/skewed/crossed marks, shared annotation references, locks/hidden flags, layers, reply threads and malformed or unsupported properties are kept unchanged. The editor shows their count. Their original appearances remain visible, while admitted highlights are removed only from a disposable canvas copy and represented by editable overlays. Moving or deleting one therefore removes its old preview position. Original source bytes remain available for export/history.

Untouched supported marks keep their original dictionary/appearance. Editing retains their author, identity and popup reference while updating geometry, comment, color, modification time and appearance. Deletion removes the page annotation and associated popup references. It is not a hidden-data purge or an incremental signed-document edit.

## Evidence and limits

The [engine decision](A1_FEASIBILITY.md) admits this narrow capability using the existing MIT-licensed pdf-lib dependency. No AGPL engine, new license, backend, account permission or external document request is introduced. Existing page-text/image replacement and structure-preserving redaction remain deferred.

[Unit/output contracts](../tests/a1Highlights.test.ts) and [independent verification](../scripts/verify-a1-highlights.py) cover rotated/cropped geometry, rendered pixels, searchable originals, links/forms/bookmarks/labels, unsupported annotations, source identities, and edit/save/reopen in PyMuPDF 1.26.6. [Browser journeys](../e2e/a1-native-highlights.spec.ts) cover editing, reimport, preview consistency, duplication/undo/deletion, mobile disclosure, local-only requests and automated accessibility. CI retains synthetic A1 artifacts; the PR records exact tested SHAs and live output evidence.

Highlights do not securely remove content. The default new opacity is 28%; imported supported opacity is retained. Existing RGB colors are represented by 8-bit editor channels. Text-selection markup, multi-line/skewed geometry, reply editing and arbitrary native annotation types are not added. PDFs with a custom page scale (`/UserUnit` other than 1) are refused by Edit PDF before editing/export because accurate placement is not yet supported. Failed new imports clear stale overlays/downloads. Whole-document rewrite/preservation and signature warnings remain. Existing 1,000-object/history/resource budgets apply; no higher memory/device support claim is made.

Prior pending acceptance remains: physical camera/devices, NVDA/VoiceOver, Safari offline execution, real authenticated cloud, and the 30-attempt moderated usability protocol. R7's installed-profile update failed closed in one automation profile; generated-worker browser recovery tests passed. This release does not claim that profile limitation was diagnosed or resolved.
