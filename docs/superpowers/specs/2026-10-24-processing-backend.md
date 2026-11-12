# DocFlow isolated processing service

Scope approved by the user's instruction to finish all stages and issue #38: real Office → PDF, broader image compression and searchable scans, followed by the missing v2 adapters and release acceptance. Native source editing is published at f46b720; its quality and three-browser v2 CI passed. The full legacy browser suite remains separate migration work.

## Architecture selected for implementation

- Reuse the existing DocFlow Supabase project (eu-central-1) for authenticated job ownership, private temporary objects and state. Current schema contains only preference sync; no existing document storage or Edge Functions will be replaced.
- A Supabase Edge broker validates the user JWT, options, idempotency and quotas. It issues path-scoped upload credentials, starts an opaque worker claim, returns status, handles cancellation, signs verified downloads and expires/purges objects. Service credentials never leave the broker.
- A separate Vercel worker uses one nonpersistent Firecracker Sandbox per processing job, pinned to a prepared engine snapshot. VM egress is denied; input bytes enter through the control plane and only verified output leaves. No account or project credential is passed into the VM. The worker's API validates a short-lived claim against the fixed broker before allocating compute.
- Python engines run LibreOffice, pikepdf/Pillow and OCRmyPDF/Tesseract/PDFium. Ghostscript is evaluated separately and is not required for initial PDF OCR output. Exact engine/font versions and snapshot provenance are recorded. PDF/A and PDF → editable Office are separate milestones.

The local execution environment cannot create nested user/network namespaces and has no Docker/LibreOffice. It must not be represented as a production sandbox. Local synthetic engine tests and hosted VM tests are distinct evidence.

## API and ownership

`POST /api/v1/jobs` takes one declared file, operation, validated options, a UUID idempotency key and acknowledged server-processing notice. `POST /jobs/:id/start`, `GET /jobs/:id`, `POST /jobs/:id/cancel`, and `GET /jobs/:id/downloads` require the same authenticated owner. Object URLs are never public. States are queued, running, cancelling, cancelled, completed, failed and expired; phase distinguishes awaiting upload from a runnable queued job.

Creation and worker claims use transactional quota/lease checks. Duplicate starts cannot run two VMs. Worker completion cannot replace a cancelling, cancelled or expired result. A restarted worker cannot publish an obsolete attempt. A crash leaves an expiring lease and a recoverable/terminal job, not a forever-running record.

Initial staging caps: one file up to 25 MB, at most 100 pages for PDF processing, one active job per owner, two globally active processing jobs, ten processing starts globally per rolling 24 hours, a 180-second processing deadline and bounded output. Options expose actual JPEG quality, image resolution and OCR language/deskew/orientation controls.

Input objects expire after 30 minutes; completed outputs are retained for 30 minutes. Downloads last 60 seconds and use cache-control zero/no-store. Supabase signed upload tokens are fixed at two hours, so expired-job tombstones and orphan cleanup must cover that replay window; do not describe those upload tokens as ten-minute credentials. Minimal job records expire after 24 hours. Cleanup must remove Storage objects through the Storage API, not delete only database metadata.

## Output and security gates

Verify magic bytes and measured sizes/hashes; inspect OOXML entries and expanded/compressed budgets before LibreOffice; reject macros, external relationships and unsupported formats. Use fixed filenames and argv, never interpolate user data into a shell. Restrict files/paths, decompression, pixels, page count, subprocess time and output size. Cancellation stops the real VM and purges unpublished output.

Office fixtures cover pagination, tables, fonts, images and charts in DOCX/PPTX/XLSX. Compression must preserve selectable text and tested annotations/forms/metadata, report actual savings and preserve the original when there is no benefit. Unsupported image encodings/effects are counted and left unchanged. OCR preserves tested original visuals and adds a searchable layer; English/German CER/WER, rotation and deskew are measured. A successful HTTP response alone is not acceptance.

The v2 UI will expose remote capabilities only after the hosted service produces benchmarked outputs. Users see the provider, upload/retention implications and meaningful failures before transferring documents. Only synthetic fixtures are used during development.
