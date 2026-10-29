# Processing backend acceptance — in progress

Native editing is published at f46b720. This stage has not enabled server document upload in the v2 UI.

## Verified locally

- Nine portable contract tests: strict request types, current upload consent, MIME/extension matching, actual compression controls, OCR language controls, bounded files, scoped signed URLs, measured outputs and cancellation/publication races.
- Twelve Python synthetic tests: real image resampling and size savings, quality/DPI effects, selectable text, annotations/metadata, transparency and explicit JPEG colour-transform preservation, exact original on no benefit, signatures/page limits, Office archive screening, stretched/shared images and bounded JPEG/content decompression.
- Independent PDFium reopen/render of engine output, alongside pikepdf checks.
- English and German synthetic OCR fixtures each achieved CER/WER 0.0 with pixel-identical visible scans when deskew/rotation were disabled (1.17 s and 1.91 s locally). This two-document corpus does not establish production OCR accuracy.
- The five-file Ubuntu CI corpus completed: English/German OCR each CER/WER 0.0, visible scans unchanged, and two-page DOCX/PPTX/XLSX conversions. All five output PDFs were independently opened with PyMuPDF. [Corpus artifact](https://github.com/ZubaerAhmed13/zubaer-ahmed-PDF-TEST/actions/runs/40039996213/artifacts/12538599721). The workflow itself was marked cancelled despite passing test steps; do not describe the whole run as green.
- Applied the new processing migration to the existing DocFlow Supabase project. Transactional synthetic probes passed for owner/other-owner/anonymous access, client write denial, idempotency, duplicate claims, stale attempts and cancellation winning over completion. Synthetic records were rolled back; the processing bucket is private. This is SQL/RLS evidence, not an authenticated browser login test.
- Backend pins Sandbox 3.9.0, Supabase JS 2.118.0 and Vercel Functions 3.10.3. The CLI-config transitive Zod 4.1.11 is overridden with compatible 4.6.7; audit and typecheck are release gates.
- Review reproduced five defects; their regressions are covered. A subsequent explicit JPEG colour-transform finding is also covered. Unsupported appearance contexts and image encodings are left intact or rejected conservatively.

The initial staging budget is **ten processing starts globally per rolling 24 hours**, two concurrently running jobs globally, one active job per owner, 25 MB input, 50 MB output, 100 PDF pages and 180 seconds per VM. These are staging limits, not production capacity claims.

## Staging preparation

Project: `docflow-processing-staging`, Vercel project `prj_D5F093AlNXcRHf9UsKVAv5NYqAXV`, team `team_4VtWGFD5vMH5UwLvIRKK3syR`, Frankfurt. It is separate from the DocFlow frontend. The preparer runs only in an explicitly requested deployment build, creates a clean engine VM, installs pinned Python dependencies and records actual system/font versions, then tests a nonpersistent network-denied snapshot. Builder and processor VMs receive no user files or provider credentials.

On 29 October, Vercel team access succeeded. The first actual builder exposed a command-directory defect, fixed in 9d085f4 by explicitly using `/vercel/sandbox`. The corrected build ran all twelve engine tests and the five-file acceptance corpus, then repeated them in a network-denied VM and verified that external egress failed. It produced snapshot `snap_xmLQxHteb7AzQ5OrU68cBXYpkmiJ`, prepared at 2026-10-29T03:31:13Z, with seven-day staging retention. A separate one-vCPU, network-denied evidence VM read its saved metrics and was stopped after 27.2 seconds. [Recorded evidence](PROCESSING_ENGINE_EVIDENCE.json).

Actual snapshot versions: Python 3.14.4, LibreOffice 26.2.6.3, Tesseract 5.5.0, qpdf 12.4.2, and the pinned Python packages. OCR English/German each achieved CER/WER 0.0 and identical visible pixels in 1.117/1.111 seconds; the DOCX/PPTX/XLSX fixtures each produced two pages in 0.585/0.636/0.477 seconds. This synthetic corpus proves basic execution, not broad document fidelity or production accuracy.

After correcting the missing `backend/public` output folder, exact source 43f0b53 deployed successfully to [protected staging](https://docflow-processing-staging-9tpmcpnpo-bhuyainria-7304.vercel.app/api/health). Independent HTTP inspection returned 200, `snapshotVerified:true`, `acceptingDocuments:false` and `Cache-Control:no-store`. [Processing CI passed](https://github.com/ZubaerAhmed13/zubaer-ahmed-PDF-TEST/actions/runs/40812868207) at this source too. A health endpoint with `acceptingDocuments:false` is not backend completion. Reuse this exact verified snapshot during its retention period rather than rebuilding implicitly. No real user document has been sent to the backend.

Pricing checked against [Vercel's official Sandbox pricing](https://vercel.com/docs/sandbox/pricing). The preparer caps the builder at two vCPUs/300 seconds and its offline verification VM at two vCPUs/60 seconds; each is stopped in its lifecycle. Actual regional usage and retained snapshot size still need recording before a production cost estimate.

## Control-plane expiry verification

On 29 October, six hosted transactional SQL suites passed for owner/concurrency/daily quotas, the exact 24-hour boundary, expired claims/leases, malformed output, valid completion, RLS/idempotency/CAS/cancellation and expiry recovery. Three regressions were observed failing before fixes: dead leases stranding the owner slot, historical backlog consuming the bounded expiry batch, and an overdue targeted read returning completion metadata. The applied service-only, SECURITY INVOKER expiry helper prioritises leases still occupying a slot, and read/start/cancel expire their exact target independently of the sweep. Completed expiry clears output/path/request/details together while retaining rows and started timestamps for quota accounting. Fresh review independently rechecked both backlog fixes. [Recorded evidence](PROCESSING_LIFECYCLE_EVIDENCE.json).

The database function-body hashes match the committed migration source. The CLI-generated expiry file was aligned with provider-applied history `20261029202039`; the unchanged original processing migration was likewise aligned with its observed provider version `20261023232005`. No SQL body was changed by that original-file rename. Every probe rolled back; final synthetic job/user counts are zero, and no Storage object or VM was created. Security advisors show the same two existing findings, with no new finding. This establishes control-plane expiry, not physical file deletion or authenticated transport acceptance.

## Remaining release gates

- Expand the hosted corpus beyond synthetic fixtures: Office font/layout fidelity, diacritics, mixed scan/text pages, skew/rotation and low-quality scans. Retain actual output artifacts for independent review.
- Real broker ownership/load/error acceptance, beyond the completed SQL quota/lease/output probes. Existing preference tables are untouched.
- Authenticated broker, real VM cancellation, signed input/output validation, expiry and Storage API purge, including the fixed two-hour signed-upload replay window.
- Browser → authenticated job → verified output acceptance and explicit upload/retention notice. No remote capability is advertised until those pass.
- Repair/PDF-A and PDF → editable Office are separate evidence gates. No PDF/A or editable-Office fidelity claim is made here.

Supabase advisors report the intentional deny-all private claims table as [RLS-without-policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) (INFO). The existing project also has [leaked password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) (WARN); no global Auth setting was changed by this migration.
