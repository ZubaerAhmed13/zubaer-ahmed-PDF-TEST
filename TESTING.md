# Testing

## Automated layers

### Unit
`npm test`

Covers page/range validation and core structural PDF transformations.

### Type and lint
`npm run typecheck`
`npm run lint`

### Build
`npm run build`

The build must succeed with the nested GitHub Pages base path and produce `dist/`.

### End-to-end
`npm run test:e2e`

Playwright projects:
- Chromium
- Firefox
- WebKit

Current smoke workflows cover shell load, search, keyboard command access, unified workspace and Chromium offline reload.

## Release fixtures still required

The professional release requires generated/public non-confidential fixtures for:
- 1–5 pages
- 50+ pages
- 100+ pages
- 300 pages
- high-resolution scanned PDF
- mixed page sizes
- AcroForm field types
- XFA detection
- encrypted PDF
- malformed/corrupt PDF
- metadata
- image-heavy PDF

Tests must reopen generated PDFs and validate page count, dimensions, rotation and form values where applicable.

## Manual verification still required

- keyboard-only complete workflows
- screen reader semantics
- focus trapping/return across every dialog
- mobile widths
- real Safari/iOS behavior
- memory growth after repeated open/close cycles
- color/fidelity comparisons
