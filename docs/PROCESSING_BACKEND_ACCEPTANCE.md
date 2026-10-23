# Processing backend acceptance — in progress

Native editing is published at f46b720. This stage has not enabled server document upload in the v2 UI.

## Verified locally

- Nine portable contract tests: strict request types, current upload consent, MIME/extension matching, actual compression controls, OCR language controls, bounded files, scoped signed URLs, measured outputs and cancellation/publication races.
- Twelve Python synthetic tests: real image resampling and size savings, quality/DPI effects, selectable text, annotations/metadata, transparency and explicit JPEG colour-transform preservation, exact original on no benefit, signatures/page limits, Office archive screening, stretched/shared images and bounded JPEG/content decompression.
- Independent PDFium reopen/render of engine output, alongside pikepdf checks.
- English and German synthetic OCR fixtures each achieved CER/WER 0.0 with pixel-identical visible scans when deskew/rotation were disabled (1.17 s and 1.91 s locally). This two-document corpus does not establish production OCR accuracy.
- LibreOffice 24.2.7 packages were obtained locally, but its UNO bootstrap fails in this managed runtime. Actual DOCX/PPTX/XLSX tests are in the Ubuntu 24.04 CI job; those outputs remain pending until CI runs.
- Applied the new processing migration to the existing DocFlow Supabase project. Transactional synthetic probes passed for owner/other-owner/anonymous access, client write denial, idempotency, duplicate claims, stale attempts and cancellation winning over completion. Synthetic records were rolled back; the processing bucket is private. This is SQL/RLS evidence, not an authenticated browser login test.
- Backend pins Sandbox 3.9.0, Supabase JS 2.118.0 and Vercel Functions 3.10.3. The CLI-config transitive Zod 4.1.11 is overridden with compatible 4.6.7; audit and typecheck are release gates.
- Review reproduced five defects; their regressions are covered. A subsequent explicit JPEG colour-transform finding is also covered. Unsupported appearance contexts and image encodings are left intact or rejected conservatively.

The initial staging budget is **ten processing starts globally per rolling 24 hours**, two concurrently running jobs globally, one active job per owner, 25 MB input, 50 MB output, 100 PDF pages and 180 seconds per VM. These are staging limits, not production capacity claims.

## Staging preparation

Project: `docflow-processing-staging`, Vercel project `prj_D5F093AlNXcRHf9UsKVAv5NYqAXV`, team `team_4VtWGFD5vMH5UwLvIRKK3syR`, Frankfurt. It is separate from the DocFlow frontend. The preparer runs only in an explicitly requested deployment build, creates a clean engine VM, installs pinned Python dependencies and records actual system/font versions, then tests a nonpersistent network-denied snapshot. Builder and processor VMs receive no user files or provider credentials.

Snapshot preparation/hosted acceptance is blocked by Vercel deployment API 403 for team `team_4VtWGFD5vMH5UwLvIRKK3syR` (scope `bhuyainria-7304`). The API requests team authorization, but this connector exposes neither `authorize_team_access` nor `authorize_team_sso`; no deployment or VM was created. Do not remove the team selector or substitute credentials to bypass this boundary. A health endpoint with `acceptingDocuments:false` is not backend completion. Reuse a verified snapshot on subsequent deployments instead of rebuilding it implicitly. Prepared snapshots expire after seven days during staging.

Pricing checked against [Vercel's official Sandbox pricing](https://vercel.com/docs/sandbox/pricing). The preparer caps the builder at two vCPUs/300 seconds and its offline verification VM at two vCPUs/60 seconds; each is stopped in its lifecycle. Actual regional usage and retained snapshot size still need recording before a production cost estimate.

## Remaining release gates

- Actual LibreOffice DOCX/PPTX/XLSX pagination/table/chart/font corpus, English/German OCR CER/WER and visual-preservation corpus in the hosted offline VM.
- Additional quota/lease-expiry and malformed worker-output probes, followed by real broker acceptance. Existing preference tables are untouched.
- Authenticated broker, real VM cancellation, signed input/output validation, expiry and Storage API purge, including the fixed two-hour signed-upload replay window.
- Browser → authenticated job → verified output acceptance and explicit upload/retention notice. No remote capability is advertised until those pass.
- Repair/PDF-A and PDF → editable Office are separate evidence gates. No PDF/A or editable-Office fidelity claim is made here.

Supabase advisors report the intentional deny-all private claims table as RLS-without-policy (INFO). The existing project also has [leaked password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) (WARN); no global Auth setting was changed by this migration.
