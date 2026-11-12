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

Playwright runs the maintained `e2e/v2-*.spec.ts` suites in Chromium, Firefox and WebKit. The public build omits the server-processing suite. The isolated preview workflow sets `VITE_DOCFLOW_SERVER_PROCESSING=1` with a browser-test key and runs those mocked server journeys too.

The current suite covers long documents, image limits, forms, encryption, compression, cleanup, keyboard and responsive layouts. The release journeys open all 29 public routes, confirm the scoped service worker, and reopen downloads from rotation, crop, metadata editing, organization, annotation and numbering. They verify exact previous and next revision bytes and confirm that the rotation-to-encryption handoff sends no document requests.

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
DOCFLOW_PRODUCTION_BASE_URL=https://zubaerahmed13.github.io/zubaer-ahmed-PDF-TEST/ \
DOCFLOW_EXPECTED_BUILD=your_deployed_commit_sha npm run test:production
```

The production config runs the deployed Chromium journeys for the public tool catalog, PDF downloads, visual form fill/flatten, image exports, OCR, comparison, workflow/ZIP, redaction, repair and AES-256. It uses two workers. Stress, build fault injection and mocked account or server jobs run separately. GitHub Actions supplies the expected deployment SHA through `GITHUB_SHA`. The identity check waits for `release.json` to report that exact commit.

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


## Historical browser suites

The older specifications are kept as a reference for release parity. To run them against their matching interface, check out the legacy release in a separate worktree and use the Playwright configuration from that release.

```bash
git worktree add --detach ../docflow-legacy 0b680cf5929cf76065a1948ca7690f4d90118a9d
cd ../docflow-legacy
npm ci
npx playwright install --with-deps
npm run test:e2e
```

### R1 session acceptance

`tests/documentSession.test.ts` chains real organize/annotate/number PDF operations and verifies exact-byte history, duplicate identities, history pruning, redaction barriers, invalid/stale results, multi-output selection and disposed-runtime callbacks. `tests/serviceWorkerUpdate.test.ts` executes the actual generated worker message handler for safe, busy/retained-work and unresponsive tabs.

`e2e/document-session.spec.ts` covered one-import chaining, original/current separation, session resume, same-named merge, selected split output, narrow/axe/leave protection, redaction cancellation and applied-redaction history clearing. It also exercised the live two-tab service-worker handshake in Chromium. The v2 release journey carries forward chaining and exact revision downloads. The historical cases remain useful for reviewing v2 parity. Physical device and manual screen-reader acceptance remain independent.

### R7 product finish and operations

`tests/r7Product.test.ts` pins intent discovery and diagnostic allowlisting/redaction. `tests/r7Availability.test.ts` checks identity drift and asset failures. `e2e/r7-product-finish.spec.ts` covers discovery, nested workspace help, guards, reviewed diagnostic downloads, local data scope/denial, mobile axe and exact metadata. `e2e/update-recovery.spec.ts` serves the built release on an isolated origin with controlled baseline/broken/recovered markers, using the production-generated worker and real exports. It never changes the public deployment.

The separate `check:availability` command probes identity and assets in four requests. The legacy R7 journeys remain the reference for reviewed diagnostic downloads and scoped local-data controls. Human and device evidence is recorded in `docs/R7_ACCEPTANCE.md`, which defines its moderated acceptance threshold.

### A1.1 native highlights

`tests/a1Highlights.test.ts` checks true native objects, unchanged original content streams, searchable text, catalog/links/forms, four rotations with an offset CropBox, import after independent viewer edits, author/popup retention, unsupported annotation preservation, malformed flags/crossed geometry, shared references, custom-page-scale refusal and forged/duplicate identities. `scripts/verify-a1-highlights.py` independently checks displayed quad bounds, highlight/neighbor pixels and edit/save/reopen in PyMuPDF 1.26.6. Synthetic artifacts are retained under `artifacts/a1/` in quality CI.

`e2e/a1-native-highlights.spec.ts` is the reference for the native highlight create/export/reimport, property edit, duplicate, undo and delete journey. It also checks canvas cleanup, local-only requests, axe, mobile unsupported-mark retention and stale-state cleanup after a rejected custom-scale import. Keep native highlight reimport and editing open in the v2 release gates until the current interface passes those journeys.
