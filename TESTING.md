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

CI currently reports zero known npm vulnerabilities for the locked dependency graph. This is evidence for the executed audit only, not a blanket security guarantee. The separately vendored qpdf WASM runtime is tracked by immutable upstream commit, Git blob SHAs, SHA-256 values and license provenance under `src/vendor/qpdf/`.

### Build
`npm run build`

The build must succeed with the nested GitHub Pages base path and produce `dist/`. Bundle sizes are reported by CI. The production build emits the qpdf worker and the local qpdf WASM asset and includes generated application assets in the service-worker precache manifest.

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
- visual page organization with lazy thumbnails, duplicate, multi-select delete, undo, move controls and structural export/reopen validation;
- deterministic typed page-order compatibility with the visual organizer;
- AcroForm inspection/fill/export/reopen across text, checkbox, radio, dropdown and option-list fields;
- AcroForm flattening with reopened-export verification;
- a valid PDF containing an AcroForm `/XFA` stream, which must be rejected explicitly as `UNSUPPORTED_FORM`;
- metadata extraction from a real fixture;
- malformed `%PDF-` input recovery with structured `INVALID_PDF` reporting and a still-usable workspace, including lazy page-tree corruption detected after initial container parsing;
- text-watermark export/reopen validation;
- PNG/JPEG image-watermark UI, worker export, PDF reopen and embedded-image resource validation;
- image conversion workflows;
- decoded embedded-raster `Extract images`, including real ZIP download, PNG signature and manifest/dimension validation;
- bounded batch processing of multiple PDFs sequentially with one active worker, per-file outputs, optional ZIP packaging and reopened-output validation;
- batch isolation where one malformed PDF reports `INVALID_PDF` while later valid queue items still complete and remain downloadable;
- deterministic batch cancellation leaving no queue item running/pending;
- local AES-256 Protect PDF with a pinned qpdf 12.3.2 WASM worker;
- protected-output validation using `%PDF-`, an `/Encrypt` dictionary and refusal by ordinary pdf-lib loading without a password;
- direct verification that the known security test password is absent from DocFlow localStorage and the project-state IndexedDB snapshot after protection;
- Unlock PDF wrong-password rejection with structured `INVALID_PASSWORD` recovery and a reusable workspace;
- correct-password decryption followed by reopened output, page-count and mixed-dimension geometry validation;
- no cross-origin network requests during the protect/wrong-password/unlock round trip;
- Chromium and Firefox forced-offline reload followed by a real local qpdf AES-256 Protect PDF operation and encrypted output validation;
- WebKit forced-offline Cache Storage verification for the hashed encryption workspace chunk, qpdf worker and qpdf WASM, combined with the separately executed normal WebKit qpdf protect/unlock workflow because Playwright WebKit 26.5 blocks newly created workers after its forced-offline shim is enabled;
- a 300-page mixed-dimension rotate/export/reopen workflow with page count, rotation and sampled geometry assertions;
- repeated preview open/navigate/close cycles with dedicated worker termination, canvas removal and page-error checks;
- keyboard-triggered workspace/information dialogs with focus containment and exact trigger focus return;
- no cross-origin network requests during core PDF processing;
- GitHub Pages PWA manifest/service-worker path resolution;
- automated axe checks for serious/critical homepage violations;
- responsive shell/workspace overflow checks at 360, 768 and 1280 px;
- Chromium and Firefox offline reload plus local worker-backed core PDF processing;
- WebKit application-shell/chunk precache certification plus normal worker workflows;
- IndexedDB recovery of tool settings/file metadata with direct verification that document bytes are not stored and that file reselection is required.

## Executed fixture coverage

Executed automated fixtures now include:
- small 1–5 page PDFs across structural/export workflows;
- a two-page mixed-dimension PDF protected with AES-256, tested with a wrong password, then unlocked and reopened with original geometry;
- the same security path executed after a forced-offline reload in Chromium and Firefox;
- multiple-PDF batch queues, including a deliberately malformed item followed by a valid item;
- a 40-page PDF for thumbnail virtualization behavior;
- a 300-page mixed-dimension PDF, which also exercises the 50+ and 100+ page-count thresholds;
- mixed page dimensions;
- AcroForm text, checkbox, radio, dropdown and option-list fields;
- a valid XFA-stream PDF boundary fixture;
- malformed/corrupt PDF input, including a `%PDF-` container whose lazy page tree fails traversal;
- metadata-bearing PDF input;
- PNG/JPEG image inputs for conversion/watermark paths.

Page-count certification must not be described as multi-gigabyte certification; those remain separate gates.

## Release fixtures still required

The professional release still requires non-confidential fixtures/evidence for:
- high-resolution scanned PDFs;
- image-heavy PDFs at realistic high resolution;
- professional image recompression quality/size comparisons;
- multi-gigabyte source-file architecture and certification;
- color/fidelity comparisons where operations can alter rendered appearance.

## Explicitly unsupported / not yet implemented

- OCR/text-layer generation;
- cryptographic digital-signature creation or validation;
- professional image recompression.

These must not be promoted as supported until a real engine and executed certification exist.

## Manual verification still required

- keyboard-only complete end-to-end workflows beyond the automated dialog-focus coverage;
- screen reader semantics and announcements;
- WCAG 2.2 AA manual certification;
- real Safari/iOS behavior, including forced-offline worker execution;
- heap/memory growth measurement after repeated open/close/process cycles (the automated cleanup test verifies worker/canvas release but is not a heap-growth certification);
- high-resolution scan and image-heavy memory behavior;
- color/fidelity comparisons;
- production GitHub Pages deployment verification after release-candidate merge.
