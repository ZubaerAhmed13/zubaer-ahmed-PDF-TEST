# U8 — Create editable PDF form fields

Date: 20 October 2026 · Separate release, intentionally limited

## Existing capability versus new capability
U7 already fills existing AcroForm fields and provides an on-page form overlay. U8 adds **genuine new AcroForm field creation** to ordinary PDFs. These controls are written by pdf-lib and persist as editable PDF widgets after download and reopen; they are **not** drawn-text imitations.

## User journey
1. Choose **Fill PDF forms** from the tools catalogue; upload a source PDF.
2. Change **Form task** to **Create new editable fields**. Source PDF remains unchanged.
3. Add Text field, Checkbox, or Dropdown. For each, enter a unique field name, one-based page, top/left percentages, size and optional Required setting. For Dropdown, enter valid choices.
4. Run **Create editable PDF fields** and receive `form-fields-added.pdf` on the normal dedicated result/download page.
5. Open the new PDF in Fill PDF forms to inspect and fill the created fields.

## Processing and validation
- Real `forms-create` Web Worker operation; bytes never leave the browser.
- Rejects XFA, password-protected or malformed PDFs, missing/duplicate names, impossible geometry, pages outside the document, widgets smaller than 12 points, empty dropdown choices, more than 40 fields and field-name collision with the existing PDF form.
- Uses the PDF page dimensions for conversion from top-left percentages to PDF points. Respects original pages and retains their visual content.
- Existing Fill, flattening, advanced JSON, form overlay and other tools are unchanged.

## Important limitations
- This first release **does not reposition fields by dragging on the page**. Percentage-based placement is the supported method. A later release will add a visual on-page placement overlay with keyboard alternatives.
- It does not rename, delete or reposition pre-existing fields. Field value editing is available in the existing Fill action. Full structural edits are separate work.
- It does not create certified digital signatures, handle XFA forms or guarantee all external PDF viewers display identical appearances.
- Field creation requires an existing PDF source; blank PDF creation is not in scope.
- No promise of two-times faster UX without usability testing.

## Acceptance
- A two-page PDF receives a required text field, a checkbox and a dropdown on requested pages. After export/reload, pdf-lib can read their names, types, choices, positions and required settings.
- Duplicate names are rejected without a generated document.
- The default Fill existing fields path remains completely compatible.
- TypeScript, lint, unit tests, production build, Chromium, Firefox, WebKit and real-device mobile review required before merge.
