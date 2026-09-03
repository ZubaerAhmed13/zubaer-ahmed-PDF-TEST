# Testing

## Automated layers

### Unit
`npm test`

Covers page/range validation, core structural PDF transformations, structured error normalization, and image-watermark embedding/error handling.

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
- worker-backed PDF merge with downloaded export reopen validation;
- structural edit exports reopened and validated;
- split, remove-pages and extract-pages output checks;
- PDF.js worker preview/navigation;
- a 40-page virtualized thumbnail rail that keeps only an overscanned visible window in the DOM and navigates to page 40;
- AcroForm inspection/fill/export/reopen across text, checkbox, radio, dropdown and option-list fields;
- AcroForm flattening with reopened-export verification;
- a valid PDF containing an AcroForm `/XFA` stream, which must be rejected explicitly as `UNSUPPORTED_FORM`;
- metadata extraction from a real fixture;
- malformed `%PDF-` input recovery with structured `INVALID_PDF` reporting and a still-usable workspace;
- text-watermark export/reopen validation;
- PNG/JPEG image-watermark UI, worker export, PDF reopen and embedded-image resource validation;
- image conversion workflows;
- decoded embedded-raster `Extract images`, including real ZIP download, PNG signature and manifest/dimension validation;
- a 300-page mixed-dimension rotate/export/reopen workflow with page count, rotation and sampled geometry assertions;
- repeated preview open/navigate/close cycles with dedicated worker termination, canvas removal and page-error checks;
- keyboard-triggered workspace/information dialogs with focus containment and exact trigger focus return;
- no cross-origin network requests during core PDF processing;
- GitHub Pages PWA manifest/service-worker path resolution;
- automated axe checks for serious/critical homepage violations;
- responsive shell/workspace overflow checks at 360, 768 and 1280 px;
- Chromium and Firefox offline reload plus local worker-backed PDF processing;
- WebKit offline precache inspection plus a separate normal WebKit worker-backed PDF workflow, because Playwright WebKit 26.5 blocks worker/network creation after forced-offline mode before the service worker can answer;
- IndexedDB recovery of tool settings/file metadata with direct verification that document bytes are not stored and that file reselection is required.

## Executed fixture coverage

Executed automated fixtures now include:
- small 1–5 page PDFs across structural/export workflows;
- a 40-page PDF for thumbnail virtualization behavior;
- a 300-page mixed-dimension PDF, which also exercises the 50+ and 100+ page-count thresholds;
- mixed page dimensions;
- AcroForm text, checkbox, radio, dropdown and option-list fields;
- a valid XFA-stream PDF boundary fixture;
- malformed/corrupt PDF input;
- metadata-bearing PDF input;
- PNG/JPEG image inputs for conversion/watermark paths.

Page-count certification must not be described as multi-gigabyte certification; those remain separate gates.

## Release fixtures still required

The professional release still requires non-confidential fixtures/evidence for:
- encrypted/password-protected PDF unlock/protect workflows;
- high-resolution scanned PDFs;
- image-heavy PDFs at realistic high resolution;
- professional image recompression quality/size comparisons;
- multi-gigabyte source-file architecture and certification;
- color/fidelity comparisons where operations can alter rendered appearance.

## Manual verification still required

- keyboard-only complete end-to-end workflows beyond the automated dialog-focus coverage;
- screen reader semantics and announcements;
- WCAG 2.2 AA manual certification;
- real Safari/iOS behavior, including offline worker execution;
- heap/memory growth measurement after repeated open/close/process cycles (the automated cleanup test verifies worker/canvas release but is not a heap-growth certification);
- high-resolution scan and image-heavy memory behavior;
- color/fidelity comparisons;
- production GitHub Pages deployment verification after release-candidate merge.
