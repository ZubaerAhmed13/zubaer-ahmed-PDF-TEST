# Testing and evidence

## Commands
```bash
npm ci
npm audit --audit-level=high
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Playwright runs Chromium, Firefox and WebKit. Existing 300-page, 300-DPI, forms, encryption, compression, cleanup, keyboard and responsive fixtures remain release-blocking.

## Synthetic corpus v1
Source: tests/fixtures/pdfCorpus.ts. Fixtures contain no personal documents and use fixed dates.
- Independent PDF.js rasterisation of downloaded redaction output checks every interior mask pixel and neighbouring pixels at all four page rotations with non-zero CropBoxes.
- Forms, attachments and shared image objects verify source-object exclusion.
- Deterministic cancellation during actual PNG encoding verifies no partial download.
- Wrong-startxref/missing-xref cases verify actual repair; a missing page must fail closed.
- Repair checks every page/operator list before exposing a download.
- Rotation retains corpus form/catalog data. Page-copy paths retain selected text and record catalog observations in artifacts/r0/preservation.json.

## Production verification
```bash
DOCFLOW_PRODUCTION_BASE_URL=https://zubaerahmed13.github.io/zubaer-ahmed-PDF-TEST/ npm run test:production
```

The production config runs all-tool loading, visual form fill/flatten, image colour exports, actual OCR, comparison, workflow/ZIP and redaction/repair suites, plus rotation/AES-256. Two workers bound the load; expensive stress remains pre-deployment.

R0 baseline attachments contain two viewport samples of navigation/FCP/overflow and axe findings on the CI machine. They are not manual WCAG, physical-device, LCP/INP or field-performance certification.

## Cloud evidence
Mocked cloud-sync E2E verifies UI/payload behaviour, not real authentication.
supabase/tests/docflow_preferences_rls.sql verifies own CRUD/upsert, denied cross-user access/reassignment, array limits, anonymous denial and least privileges. All synthetic users/rows are rolled back. Run through the authorised project SQL connection or:
```bash
psql -v ON_ERROR_STOP=1 -f supabase/tests/docflow_preferences_rls.sql
```
Never remove the rollback. Live email/login/two-browser sync remains an explicit acceptance item in the cloud documentation.

## Limits
OCR is implemented; certificate signing/original-page text replacement are not. No arbitrary file-size, print-proof colour or PDF/UA claim. WebKit cache evidence is separate from real Safari/iOS offline workers. Pixel/structure fixtures establish supported cases, not all PDFs.

[Capability matrix](docs/CAPABILITIES.md) · [Preservation](docs/R0_PRESERVATION_MATRIX.md) · [R0 evidence](docs/R0_RELEASE.md).


## R1 session acceptance

`tests/documentSession.test.ts` chains real organize/annotate/number PDF operations and verifies exact-byte history, duplicate identities, history pruning, redaction barriers, invalid/stale results, multi-output selection and disposed-runtime callbacks. `tests/serviceWorkerUpdate.test.ts` executes the actual generated worker message handler for safe, busy/retained-work and unresponsive tabs.

`e2e/document-session.spec.ts` verifies one-import chaining and export/reopen, original/current separation, session resume, same-named merge and selected split output, narrow/axe/leave protection, active redaction cancellation and applied-redaction history clearing. Chromium additionally verifies the actual two-tab service-worker handshake. These cases run in the production configuration as well as the full browser matrix. The other two browsers skip only the live handshake case; its decision logic is covered in runtime tests. Physical device and manual screen-reader acceptance remain independent.

## R7 product finish and operations

`tests/r7Product.test.ts` pins intent discovery and diagnostic allowlisting/redaction. `tests/r7Availability.test.ts` checks identity drift and asset failures. `e2e/r7-product-finish.spec.ts` covers discovery, nested workspace help, guards, reviewed diagnostic downloads, local data scope/denial, mobile axe and exact metadata. `e2e/update-recovery.spec.ts` serves the built release on an isolated origin with controlled baseline/broken/recovered markers, using the production-generated worker and real exports. It never changes the public deployment.

The production selection includes every specialised workspace family plus R0–R7 smoke journeys. The separate `check:availability` command is a four-request identity/assets probe, not document telemetry or an installed external monitor. Human/device evidence is recorded in `docs/R7_ACCEPTANCE.md`; 30 scripted attempts cannot replace its moderated acceptance threshold.

## A1.1 native highlights

`tests/a1Highlights.test.ts` checks true native objects, unchanged original content streams, searchable text, catalog/links/forms, four rotations with an offset CropBox, import after independent viewer edits, author/popup retention, unsupported annotation preservation, malformed flags/crossed geometry, shared references, custom-page-scale refusal and forged/duplicate identities. `scripts/verify-a1-highlights.py` independently checks displayed quad bounds, highlight/neighbor pixels and edit/save/reopen in PyMuPDF 1.26.6. Synthetic artifacts are retained under `artifacts/a1/` in quality CI.

`e2e/a1-native-highlights.spec.ts` runs in all three browsers and production: create/export/reimport/property edit/duplicate/undo/delete, clean preview canvas, local-only requests, axe, mobile unsupported-mark retention and stale-state cleanup after a rejected custom-scale import. Historical release identity smoke now compares to package.json so new releases retain the same exact-version assertion.
