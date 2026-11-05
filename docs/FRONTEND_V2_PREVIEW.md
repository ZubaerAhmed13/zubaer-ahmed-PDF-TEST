# DocFlow 2.0 hosted preview

29 October 2026: [open the separate v2 preview](https://docflow-v2-preview.vercel.app/zubaer-ahmed-PDF-TEST/). Vercel account access may be required. The rebuild remains in draft PR #36; GitHub Pages promotion is still gated on full release acceptance.

- Source: `adfdda5a5e68253a812e8bc1fdd6b2dbb0c89564`.
- Project: `docflow-v2-preview`, `prj_fsHXd83a0h2ATsqAxCuCFrtwoSII`, team `team_4VtWGFD5vMH5UwLvIRKK3syR`.
- Deployment: `dpl_CYxH27VPJhT5iHeZ3WEVWCp7GwNE`, READY.
- Exact deployment: `https://docflow-v2-preview-fn1ts2fih-bhuyainria-7304.vercel.app/zubaer-ahmed-PDF-TEST/`.
- Verified hosted release identity matches the source SHA. Index, main JS/CSS, manifest and service worker each returned HTTP 200 with expected content types through authenticated Vercel inspection.
- Local checks: 85 v2 Chromium journeys, 216 units, typecheck/lint/build/provenance. All three v2 browser CI jobs, quality and processing CI passed at this source. The final form-control appearance adjustment also passed all nine affected browser journeys.

The static preview package copies all 105 built files byte-for-byte under the existing `/zubaer-ahmed-PDF-TEST/` path, retaining worker/font URLs and service-worker scope. Its root index redirects to that path. Vercel build identity also reads `VERCEL_GIT_COMMIT_SHA`.

Although the API request specified `staging`, Vercel classified this new project's first deployment as `production` and assigned only the new preview-project aliases. An immediate cancellation attempt found the deployment already non-cancellable; its final state is READY. This provider target label does not constitute approval of the full DocFlow release. No existing frontend project/domain was promoted or reassigned, and the rebuild branch remains unmerged.

Hosted HTTP/asset checks are distinct from a hosted interactive browser smoke test, which remains open. Real devices, assistive technology, broad fidelity/memory tests and legacy scenario migration also remain open. Server processing still accepts no documents; OCR and authenticated lifecycle/purge acceptance remain separate work.

## 5 November server-workspace checkpoint

Private deployment `dpl_73c946SSoZsRpdeixWsK1yNZ7bPi` is READY at `https://docflow-v2-preview-pknym3b0c-bhuyainria-7304.vercel.app/zubaer-ahmed-PDF-TEST/`, exact source `663b45b6842aced4e927af2eaf807a8fd6ca66d4`. Authenticated HTTP verified release.json, index, main JavaScript/CSS, manifest and service worker. The 231,627-character main bundle contains the server controls. Preview-only public configuration exposes those controls; normal backend processing remains disabled. The broker allows this exact preview origin, retaining its existing owner restrictions and HTTPS policy.

The subsequent source `67fca54` adds the definite-rejection recovery fix and corrects the intercepted browser harness to respect CSP. Its matching deployment `dpl_88T1KMcoCaUeEuLGbWkxukGHR9XX` is READY at `https://docflow-v2-preview-rb98mduj2-bhuyainria-7304.vercel.app/zubaer-ahmed-PDF-TEST/`. Authenticated HTTP verified its exact release identity, index, main JS/CSS, manifest and service worker (all 200). The broker permits the latest exact preview origin; the prior preview origin was removed. At source 67fca54, Chromium 95, Firefox 94 and WebKit 94 v2 journeys passed, along with quality and processing CI. Hosted interactive smoke still reaches Vercel sign-in. This supersedes the historical no-server-UI/OCR-pending status above; production remains unchanged.

The existing engine snapshot was rechecked read-only on 5 November: status `created`, region `fra1`, expiry `2026-11-06T18:37:26.847Z`. No VM was started and no snapshot was rebuilt. Maintenance had succeeded at `2026-11-05T11:30:00.734597Z`, with zero active jobs, zero rolling-day starts and zero Storage objects. Old terminal rows have aged out through the committed cleanup policy after the full 24-hour quota window; no quota history was manually deleted.
