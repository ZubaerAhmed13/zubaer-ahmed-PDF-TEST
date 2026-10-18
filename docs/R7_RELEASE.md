# R7 · v0.9.0 — product finish and release evidence

R7 is an engineering release for the existing local PDF workspace. All 29 tools, warm/coral visual identity, transient documents, optional preference-only accounts and prior export/preservation boundaries remain. It is not a claim that every proposed human/device acceptance gate has been completed.

## Product behavior

Four practical homepage examples open photo conversion, OCR, permanent redaction and reusable workflows. The decorative workspace overview is explicitly illustrative. Intent aliases and multiword search retain category filtering and provide an accessible reset and unsupported-feature explanation.

Help & capabilities is driven by the tool registry and preservation policy. It includes each tool, export consequences, release notes, unsupported functions, offline/recovery guidance and proportional optional-account help. It is available from the homepage/footer and inside workspaces. Ctrl/Cmd+K opens workspace discovery without focusing an inert background field. Switching uses the existing session leave/processing guards; cancelling keeps unapplied edits.

English product content is centralized for future reviewed locales. No translation or PDF-content accessibility conformance is advertised. Existing Latin/Greek/Cyrillic added-text and English/German OCR limits remain.

## Reviewed diagnostics and local controls

The report is rebuilt from a fixed allowlist: format/schema, optional validated package/build identity and six optional connection/feature booleans. It reads no document, filename, form value, password, account/token, URL, user agent, arbitrary log or stored recipe. Browser support booleans do not assert storage availability, offline readiness or device certification.

The user sees a readonly JSON preview, can remove either field group, and must explicitly confirm review before downloading. Any group change invalidates approval and the previous object URL. Closing the panel releases its URL. Nothing is automatically uploaded; the user decides whether to share the saved file.

Privacy controls separately clear this browser’s favourites/recent IDs and the last recovery snapshot. The recovery action is disabled while the local workspace is open; another tab or a later operation can save again. Storage denial is reported rather than claiming persistence was cleared. Recipes retain their existing opt-in Save/Delete controls; assets retain Offline & storage controls. Cloud preference removal/account requests remain separate, with no fabricated deletion workflow or private support inbox. Public issues must exclude personal data and documents.

## Release operations

The build emits `release.json` from the same package version/Git SHA used by diagnostics. `npm run check:availability -- APP_URL EXPECTED_SHA` checks release identity, shell, compiled same-origin entry and PWA scope using four bounded read-only HTTP requests. It has no scheduler, browser-storage access or document inputs. The Pages pipeline runs it after the live export suite; it can also be run by a separate operator/monitor. No recurring external service was configured.

The recovery drill uses an isolated ephemeral HTTP origin, the actual built application and production-generated service worker. Controlled release markers exercise failed precache installation, continued export from the installed release, refusal to discard a session, then an explicitly approved forward update and successful PDF export. These are synthetic deployment markers within the test harness, not a rollback of the public site or proof of Safari offline support.

## Evidence and remaining acceptance

The PR is the authoritative exact-SHA record for local quality, three-browser CI, deployment, production export/reopen and live forward-update checks. CI retains reproducible archives, dependency/provenance checks and browser traces. Existing core regression suites continue to gate deployment. The production selection now includes the remaining specialised workspace/export suites.

The [30-attempt moderated protocol](R7_ACCEPTANCE.md) is predeclared and unexecuted. Its ≥90% unassisted target cannot be inferred from automated test counts. Physical camera/devices, NVDA/VoiceOver, Safari offline execution and real authenticated cloud acceptance remain unverified. No world-class, universal PDF compatibility, WCAG certification or full roadmap acceptance claim follows from a green pipeline.

Regression ownership: product shell/help/diagnostics → `r7-product-finish.spec.ts`; service worker/update → `update-recovery.spec.ts` and `serviceWorkerUpdate.test.ts`; PDF transforms/preservation → existing unit corpus and workspace export suites; release operator → exact-SHA deployment, live reopen and acceptance ledger. No specific human owner is invented.
