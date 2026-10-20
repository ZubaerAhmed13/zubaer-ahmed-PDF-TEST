# U7 — Form-filling experience

Date: 20 October 2026

## Motivation
The existing AcroForm inspector and PDF-page overlay can already fill supported text, checkboxes, radio groups, dropdowns and multi-choice lists with real PDF exports. A long form was hard to navigate: all fields appeared in a single undifferentiated list, with no progress, search or next-unfilled action. The user's screenshot references favour an accessible document-first form interface, not an imitation of the PDF engine.

## Delivered UI
- **Completion status** and native progress meter calculated from writable, visible-inspector fields, using the exact values in the existing advanced JSON source of truth; all values still remain local to the PDF workflow.
- **Required field status** for inspected AcroForm required flags, without misleading claims that other field types are supported.
- **Field search** by label, with clear search-empty state and keyboard-accessible native controls.
- **Filter** by all, unfilled or required, taking into account read-only flags.
- **Next unfilled** focus action, which resets filters only when necessary and focuses a real editable control.
- Existing **First field**, Reset, Advanced JSON, on-page form controls, review/flatten and real export remain operational.
- Accessible focus rings, 44px controls, compact responsive panel layout and no backend additions.

## Constraints
- This release improves filling *existing AcroForm fields*. It does not create form fields in PDFs that lack them, does not support unsupported XFA workflows and is not a digital signature platform.
- Count excludes unsupported/read-only fields; 250 visual-field display cap and existing advanced JSON remain unchanged.
- Completion is an informational UI count, not an assurance of PDF validity or legal sufficiency.
- Native exports, supported inputs and privacy behaviour remain unchanged.

## Acceptance
- A five-field mixed-type fixture begins at 4/5 filled, selecting Accepted changes to 5/5; Reset restores 4/5.
- Searching `country` shows the matching field while preserving its entered value.
- Unfilled filter shows the empty checkbox, and Next unfilled focuses it.
- Advanced JSON edits update both the visual fields and completion status without overwriting user inputs.
- Existing forms inspection, round-trip typed field export, flattening, privacy, protected data and on-page overlay tests continue to pass in Chromium, Firefox and WebKit.
- Real-device mobile keyboard and form accessibility remain manual product-signoff requirements.
