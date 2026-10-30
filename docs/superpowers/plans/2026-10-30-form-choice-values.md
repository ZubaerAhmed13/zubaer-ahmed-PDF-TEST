# Form choice value preservation

Continue the authorised fidelity improvement rounds from `DELIVERY_PROGRESS.md` on the draft rebuild branch. Implement inline; keep the frontend promotion and server-upload gates intact.

**Goal:** Show readable choice labels while retaining PDF export codes, flags, option order and correct visible appearances in editable and flattened output.

**Root cause:** pdf-lib 1.17.1 exposes labels through `getOptions()`, but `getSelected()` returns export codes. Its selection validation, selected-index writer and default appearance provider treat those values as labels. Merely removing the current refusal corrupts `/V`, `/I` or displayed text.

**Design:** Keep canonical export codes in the document draft. Build labelled HTML options using those codes. Write choice `/V` and numerically sorted `/I` from validated option indices without changing flags or `/Opt`. Generate appearances with a short-lived presentation view whose selected values are labels; the actual field values remain codes. Preserve untouched appearances. For editable dropdowns translate unique suggested labels to codes and retain custom text. Continue to reject ambiguous repeated codes/labels and empty paired values, plus editable multiselect; supporting those requires index-based controls. Fix prototype-inherited field names at the same input boundary.

- [x] Reproduce the unsupported-pair gap with real paired dropdown/list PDF fixtures, multiple selection indices including 2/10, editable text, code/label collisions, unchanged fields and flattened output. Add unknown-code and inherited-field-name regressions.
- [x] Add a focused PDF choice helper, validated inspection mapping and v2 control mapping. Keep ordinary same-label/code forms compatible.
- [ ] Browser journeys select readable labels, verify synced page controls, navigate Back, export/reopen actual codes and review/flatten exact output. Independently inspect values and render appearances using MuPDF.
- [ ] Run all units, affected browser tests, v2 browser suite, typecheck, lint, build and provenance; review the bounded diff, publish to draft PR #36, and check new-head CI. Record remaining unsupported shapes and wider acceptance honestly.

Local verification: 227 units pass, typecheck/lint/build/provenance pass, independent MuPDF verification covers 12 PDFs. Initial paired-value/prototype regressions, editable-multiselect invalid-index regression and reviewer-reproduced wrapped-highlight regression each failed before their fixes. The fresh review checked collisions, flags, selected indices, existing values/appearances and rendering. Its wrapped-label finding is fixed by tracking option identity across lines; its active/synced editable-control discrepancy is resolved on blur. No unresolved important finding remains in that bounded review. Full browser/physical-device/Unicode/font acceptance is not inferred from it.

Review rulings: broader backend, legacy migration and embedded-font fidelity remain the existing separate acceptance gates; browser behavior is checked at published-head CI because the managed HTTP preview lacks a secure-context API required by the existing app. These boundaries do not authorise promotion of the rebuild or server uploads.
