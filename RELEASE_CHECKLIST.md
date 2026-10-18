# Release gates

Use the exact commit's Actions evidence and docs/R3_RELEASE.md (R0 remains historical). Historical September numbers are not current results.

## Before merge
- [ ] Dependency audit, typecheck, lint, unit/build pass.
- [ ] Full Chromium, Firefox and WebKit pass for the PR head.
- [ ] All 28 stable IDs/exports retained.
- [ ] Redaction pixel/leakage/cancellation checks pass.
- [ ] Genuine damaged-repair and fail-closed fixtures pass.
- [ ] Capability docs, preservation warnings and build identity agree.
- [ ] No new document network/persistence path.
- [ ] One-import organise → annotate → number → export and exact undo/redo pass.
- [ ] Redaction history barrier, close guards and two-tab update safety pass.
- [ ] Offline reload, Unicode edit/export/reopen and real prepared-language OCR pass.
- [ ] Missing/evicted assets, cancellation, corrupt downloads and unavailable/quota-bound storage fail visibly.
- [ ] Share activation/cancellation and cancelled pointer movement pass.
- [ ] Schema change has isolation/privilege evidence.

## After merge
- [ ] Pages builds/deploys only dist.
- [ ] Expanded deployed export/reopen suite passes.
- [ ] Release record links final main SHA/run.

## Independent acceptance (never infer from CI)
- [ ] Real email confirmation/login, two-browser Save/Restore, expiry/sign-out.
- [ ] Auth redirect settings independently inspected.
- [ ] Physical iPhone/Android offline/background/keyboard/share.
- [ ] Manual screen-reader/keyboard acceptance.
- [ ] Adequate device performance evidence for performance claims.

Local PDF tools remain usable without login. Temporary adversarial PR #5 is not a product release and must not be merged.

## R4 document quality gate

- Run `npm run benchmark:ocr`; clean fixed-corpus CER must be ≤2%. Retain checksummed per-image results.
- Pass independent Unicode/invisibility/rotation tests and R4 browser export/reopen journeys.
- Review uncertainty, range/chunk limits, correction review and model removal. Record exact release SHA and production result in the PR.
- Keep physical-camera acceptance and Safari offline execution explicitly unverified until performed.

R5: verify provenance; inspect preservation JSON and all pre-export policies; run repeat-build artifact checksum comparison; retain ZIP/manifest; verify redaction size preview and stale-draft invalidation, owned-resource lifecycle, strict oversized input behavior and existing 300-page/300-DPI suites. Record application licensing decision status and device/AT/offline limitations.

R6: export/import/rerun a local recipe, dry-run intermediate page ranges, retain successful outputs during selected retries after draft/source changes, inspect filename/share/ZIP agreement, compare the captured original and continue a result without repeating its operation. Keep protected results download-only and redaction history barriers. Run all three browser suites and the R6 production journeys; independently reopen a live workflow download and retain exact build evidence in the PR.
