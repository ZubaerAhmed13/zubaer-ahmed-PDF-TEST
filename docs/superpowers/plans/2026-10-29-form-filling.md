# Form filling v2 improvement plan

Replace the remaining JSON entry box with ordinary accessible controls and on-page widgets. Reuse the tested AcroForm inspection/fill/flatten worker. Extract the existing inspection normalization into a CSS-free domain module rather than importing legacy UI/styles.

Keep values only in the current document draft; initialize once from actual PDF fields and retain them through page changes and Back/Forward. Text, multiline text, checkboxes, radio choices, dropdowns and option lists have labelled sidebar controls, with matching on-page controls where a supported widget can be located. Read-only fields remain disabled and unchanged. Required fields are checked before export and focused when missing. Unsupported forms, excessive field/choice counts and XFA fail clearly. Limits and unsupported glyph/font behavior stay explicit.

- [x] Observe missing labelled-control and flatten-review journeys failing before implementation.
- [x] Extract/reuse inspection schema; implement bounded field controls, in-session values, page jump and canvas-aligned widgets using PDF.js viewport geometry.
- [x] Connect inspection lifecycle/cancellation, required-field validation and existing worker export to exact downloadable PDF review. Remove JSON from this user flow.
- [x] Reopen actual exports for supported field values, read-only preservation and flattening. Verify page/zoom/crop/rotation alignment, required fields, navigation and failure recovery. Distinct choice display/export pairs fail explicitly until safe engine support is verified.
- [ ] Fresh read-only review, affected and full v2 tests, unit/typecheck/lint/build/provenance and published-head three-browser CI.

This does not create new AcroForm fields, implement XFA or validate legal certificate signatures. Broad original-font fidelity and manual device/accessibility acceptance remain separate gates.
