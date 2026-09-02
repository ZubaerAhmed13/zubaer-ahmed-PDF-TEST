# Testing

## Automated layers

### Unit
`npm test`

Covers page/range validation and core structural PDF transformations.

### Type and lint
`npm run typecheck`
`npm run lint`

### Dependency/security gate
`npm audit`

CI currently reports zero known npm vulnerabilities for the locked dependency graph. This is evidence for the executed audit only, not a blanket security guarantee.

### Build
`npm run build`

The build must succeed with the nested GitHub Pages base path and produce `dist/`. Bundle sizes are reported by CI.

### End-to-end
`npm run test:e2e`

Playwright projects:
- Chromium
- Firefox
- WebKit

The current automated matrix covers:
- shell load, tool discovery and Ctrl/Cmd+K;
- unified workspace open/close;
- worker-backed PDF merge;
- structural edit exports reopened and validated;
- split, remove-pages and extract-pages output checks;
- PDF.js worker preview/navigation;
- AcroForm inspection/fill/export/reopen for the certified fixture;
- image conversion workflows;
- decoded embedded-raster `Extract images`, including real ZIP download, PNG signature and manifest/dimension validation;
- no cross-origin network requests during core PDF processing;
- GitHub Pages PWA manifest/service-worker path resolution;
- automated axe checks for serious/critical homepage violations;
- responsive shell/workspace overflow checks at 360, 768 and 1280 px;
- Chromium and Firefox offline reload plus local worker-backed PDF processing;
- WebKit offline precache inspection plus a separate normal WebKit worker-backed PDF workflow, because Playwright WebKit 26.5 blocks worker/network creation after forced-offline mode before the service worker can answer;
- IndexedDB recovery of tool settings/file metadata with direct verification that document bytes are not stored and that file reselection is required.

## Release fixtures still required

The professional release still requires generated/public non-confidential fixtures for:
- 1–5 pages
- 50+ pages
- 100+ pages
- 300 pages
- high-resolution scanned PDF
- mixed page sizes
- broader AcroForm field types
- XFA detection
- encrypted PDF
- malformed/corrupt PDF
- metadata
- image-heavy PDF

Tests must reopen generated PDFs and validate page count, dimensions, rotation and form values where applicable. Page-count certification must not be described as multi-gigabyte certification; those are separate gates.

## Manual verification still required

- keyboard-only complete workflows
- screen reader semantics
- focus trapping/return across every dialog
- real Safari/iOS behavior, including offline worker execution
- memory growth after repeated open/close/process cycles
- high-resolution scan and image-heavy memory behavior
- color/fidelity comparisons
- production GitHub Pages deployment verification after release candidate merge
