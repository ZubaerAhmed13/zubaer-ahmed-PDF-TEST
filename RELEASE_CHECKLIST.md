# Release gates

Use the exact commit's Actions evidence and docs/R1_RELEASE.md (R0 remains historical). Historical September numbers are not current results.

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
