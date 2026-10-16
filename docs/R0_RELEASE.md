# R0 — trust and correctness baseline (0.2.0)

## Scope
Current capability docs/build identity, synthetic PDF corpus, pixel-level redaction checks, actual damaged-file repair checks, all-page repair validation, wider production smoke and least-privilege preferences. All 28 tools and local PDF processing remain.

## Executed evidence
- Local baseline: typecheck/lint/unit/build passed; 53 unit cases.
- R0 adds three unit preservation/corpus cases; final exact-head quality/browser evidence belongs in the run links below.
- Live DocFlow RLS has four owner policies. Migration 20261016164742_docflow_preferences_least_privilege revoked excessive authenticated TRUNCATE/REFERENCES/TRIGGER access.
- Live transaction tests passed own CRUD/upsert, denied cross-user reads/writes/reassignment, array bounds and anonymous denial. Synthetic users/preferences rolled back; zero accounts/rows remained.
- Supabase security advisor: no lints after correction.
- HTTP inspection 16 October: HTTPS/HSTS present; no CSP response header or X-Frame-Options observed. Supported meta CSP remains; ignored meta frame-ancestors removed. Effective framing protection remains a hosting limitation, not a claimed fix.
- Local browser binary download failed. Full browser checks run on GitHub Actions; they are not counted as locally executed.

## Release status
Live release status is tracked in [PR #15](https://github.com/ZubaerAhmed13/zubaer-ahmed-PDF-TEST/pull/15) and the [Pages workflow](https://github.com/ZubaerAhmed13/zubaer-ahmed-PDF-TEST/actions/workflows/pages.yml). Merge requires passing quality and all three browsers for the final PR head. A shipped-release claim additionally requires the final main deployment and expanded production suite to pass. The PR description records the exact run links; this document does not substitute for those live states.

## Independent acceptance
There are no real Auth accounts. Email confirmation, real browser login/two-browser preference restore and Auth redirect configuration remain unverified. Local PDF use does not depend on them.

Physical iPhone/Android offline/background/keyboard/share and manual screen-reader acceptance remain open. CI viewport/axe samples are not real-device or field performance certification.

## Sources
tests/fixtures/pdfCorpus.ts; tests/preservationBaseline.test.ts; e2e/professional-redaction-repair.spec.ts; e2e/r0-baseline.spec.ts; playwright.production.config.ts; supabase/tests/docflow_preferences_rls.sql.
