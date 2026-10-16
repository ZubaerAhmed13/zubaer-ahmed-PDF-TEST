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
