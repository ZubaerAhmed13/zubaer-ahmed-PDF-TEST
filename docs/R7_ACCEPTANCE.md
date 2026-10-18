# R7 moderated acceptance protocol — predeclared, pending

This protocol records human/device evidence separately from scripts. **No attempts have been performed.** Target: at least 27 of the 30 attempts (90%) completed unassisted with no critical correctness/privacy failure. This is a proposed product acceptance gate, not a statistical claim.

For every attempt record participant code (no personal data), device/OS/browser, installed/web status, exact build SHA, synthetic fixture ID, start/end time, unassisted success, interventions, output reopen result and any critical failure. Explain the task without teaching the UI; assistance counts as unsuccessful for the threshold. Use synthetic PDFs/photos and consented observers. A follow-up run is recorded separately, never substituted silently. Run these on the intended physical devices and available assistive technology.

| Attempt | Area | Task | Outcome |
|---|---|---|---|
| 01 | Discovery | Find image-to-PDF from a receipt task | Pending |
| 02 | Discovery | Find compression using make PDF smaller | Pending |
| 03 | Discovery | Explain why Word conversion is unavailable | Pending |
| 04 | Discovery | Reset an empty filtered search | Pending |
| 05 | Session | Open a PDF and switch tools | Pending |
| 06 | Session | Cancel leaving unapplied rotation changes | Pending |
| 07 | Session | Continue an exported result in the reader | Pending |
| 08 | Editing | Add Unicode text and export | Pending |
| 09 | Editing | Position a visual signature using keyboard controls | Pending |
| 10 | Editing | Crop a rotated page and review its export | Pending |
| 11 | Pages | Reorder three pages and undo | Pending |
| 12 | Pages | Extract a selected page range | Pending |
| 13 | Pages | Merge equal-named source files | Pending |
| 14 | Forms | Fill supported AcroForm fields and reopen | Pending |
| 15 | Forms | Flatten a reviewed form | Pending |
| 16 | OCR | Prepare English offline assets | Pending |
| 17 | OCR | Recognise a selected German scan page | Pending |
| 18 | OCR | Cancel recognition and retry | Pending |
| 19 | Photos | Crop/straighten a photo before export | Pending |
| 20 | Comparison | Locate an inserted/moved page | Pending |
| 21 | Privacy | Distinguish crop from permanent redaction | Pending |
| 22 | Privacy | Redact a region and inspect output | Pending |
| 23 | Privacy | Remove a diagnostics group before download | Pending |
| 24 | Privacy | Clear local metadata without clearing recipes | Pending |
| 25 | Offline | Complete a prepared offline PDF task on Android | Pending |
| 26 | Offline | Complete a prepared offline PDF task on iPhone | Pending |
| 27 | Mobile | Export/share with the virtual keyboard and safe areas | Pending |
| 28 | Access | Complete a task with NVDA or VoiceOver | Pending |
| 29 | Repeat work | Import a recipe, preflight and export | Pending |
| 30 | Updates | Keep work during update then safely forward-recover | Pending |

## Release decision

Engineering deployment may proceed with passing automated gates and explicitly recorded human/device limitations. Full R7 product acceptance remains pending until this protocol and real-account cloud, manual accessibility and physical-device checks have evidence. Do not populate outcome cells from Playwright results.

## Rollback/forward-recovery procedure

1. Identify the last good SHA and checksum-verified release archive. Export every open document before an operator-approved deployment change.
2. Redeploy that known source through the existing gated Pages pipeline, or ship a verified forward fix. Do not force waiting workers active or clear users’ browser storage.
3. Check `release.json`, the independent availability probe and live synthetic export/reopen. Existing tabs keep their cached shell until the safe update flow is approved.
4. Keep another tab with active synthetic work open; ensure it blocks activation. Finish/export/close that tab, then retry. If an old/suspended tab cannot answer, the update fails closed.
5. Record source/deployed SHAs, fixture outcomes, cache/update behavior and remaining device limits in the release record. The isolated CI drill tests failed install → retained work → explicit forward recovery without mutating the public host.
