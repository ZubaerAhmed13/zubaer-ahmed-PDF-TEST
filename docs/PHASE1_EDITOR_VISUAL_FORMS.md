# DocFlow Phase 1 — Editor Foundation and Visual Forms

## Scope

The existing 18 registered PDF operations and their worker-based engines are preserved.

### Editor foundation
- Shared three-step guidance: **Add files → Review & edit → Export**.
- Keyboard-accessible step navigation focused on the existing Files, Preview and Settings panes.
- Stage indicator changes with selected files and exported results.
- Responsive layout and reduced-motion-aware scrolling.
- The existing multi-source editor, page visualiser, undo/redo, preview and export controls are retained; no duplicate rendering engine.

### Visual AcroForm editing
- When a PDF form is selected, the existing local forms-inspect worker automatically discovers its fields.
- Dynamic, accessible text, multiline text, checkbox, radio, dropdown and multi-select controls.
- Existing selections and form values load into visual inputs; multi-select choices are preserved.
- Reset to original values, optional advanced JSON editor (legacy-compatible), and flatten-on-export option.
- The existing worker remains the only PDF writer. XFA remains explicitly unsupported.
- Unusual field types remain explicitly unsupported visually, with advanced JSON available.
- No PDF data is uploaded.

### Privacy
- Form values are never written to the IndexedDB recovery snapshot. Form file metadata and the non-sensitive flatten preference can be saved locally as before.
- The form values are held only in the active editor until the workspace is closed.
- No change to Supabase tables/auth or optional cloud preference sync.

## Verification matrix
- Existing tool registry unchanged (18 tools).
- Unit: inspection record validation and malicious field labels.
- Browser E2E: automatic form discovery; text/checkbox/radio/dropdown/list export and reopened PDF validation; reset; manual JSON compatibility; form data not persisted.
- All existing pdf-lib/qpdf/watermark/organise/cross-browser tests remain release-blocking.
- Production deployment only after full CI and post-deployment real PDF exports.
