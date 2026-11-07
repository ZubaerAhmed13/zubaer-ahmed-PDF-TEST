# DocFlow 2.0 — clean-slate product and processing rebuild

20 October 2026 • Greenfield interface, selective preservation of verified PDF engines

## Decision

Replace the entire current visual interface and its layered DOM/CSS controllers. Do **not** add another stylesheet to the 33-file legacy cascade. Keep legacy UI files only as non-rendered migration references until replacement parity tests are complete. Do not delete/rewrite validated processing code merely for cosmetic reasons.

This is a new application architecture, **not** another U-series cosmetic release. Release from a long-running isolated branch; current production stays available until full parity and quality gates. PR #34 (old UI-based form builder) should not be merged blindly; port its tested worker functionality into the new architecture when ready.

## External comparative research (official sources)

- iLovePDF: workflow of selecting a tool, adding files, thumbnail-based page organization/reorder, then downloading. https://www.ilovepdf.com/help/documentation
- Adobe Acrobat web: selecting actual text objects, editing/replacing text and images in context, not just stamping overlay text. https://helpx.adobe.com/acrobat/web/edit-pdfs/edit-text-images-and-objects/edit-text.html
- PDF24: grouped catalog and flexible compression with image resolution/quality, deduplication, metadata/object control. https://tools.pdf24.org/en/all-tools and https://tools.pdf24.org/en/compress-pdf
- Smallpdf: cross-device file workflows and familiar discoverability, without emulating paywalls. https://smallpdf.com/download
- WCAG 2.2 target size minimum and non-drag alternatives: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum

## New information architecture

1. **Home:** minimalist product explanation, genuine instant search, top 6 actions, grouped tool catalog, drag/drop first-file affordance, clear capability language.
2. **Tool route:** stable `#/tool/<slug>` address. Contextual upload stage with file formats and selected tool clearly indicated. No hard-coded 'all PDF files' when image input is expected.
3. **Document workspace:** left file/page rail, central live PDF canvas, right contextual controls, top title + zoom + undo where supported, footer/sticky Run action. Full page editing never occurs in a floating modal.
4. **Result route:** clear processing state, download(s), output details, start another task/reuse output (when supported).
5. **Mobile:** toolbar, scrollable previews and a bottom-sheet controls approach, visible file names, touch-sized buttons, no right-side panes forced into 320px, no hidden file operations.

Route transitions are owned by one router. Files, operation state and output URLs are owned by one per-session controller. Every page gets one semantic title and a visible focus target. No dynamic DOM relocation via global mutation observers.

## Design principles

- Editorial visual language: warm white surfaces, slate ink, restrained indigo primary, soft cyan detail; one font stack and consistent spacing/typography.
- Correct content hierarchy: document is primary in work mode; upload primary before file selection; download primary after success.
- Distinct tool icon/label, truthful description, helpful defaults, progressive disclosure of advanced options.
- Use gestures as shortcuts **only**, with equivalent buttons/keyboard actions.
- Async PDF.js preview virtualization, explicit cancellation, responsive page previews, state preservation on accidental tab changes.
- Every output links to actual worker-produced bytes. No demonstration buttons pretending to edit.
- Avoid "world-class" or "2x better" claims until usability studies and rigorous comparisons are done.

## Engine strategy: results first (not browser-only)

| Capability | Best candidate | Acceptance evidence |
|---|---|---|
| Merge, split, reorder, rotate, simple fill | Browser PDF worker / qpdf server fallback | byte-level page/content preservation |
| Lossy and high-quality image compression | Ghostscript or tuned image pipeline on isolated server workers; local fast choice | target file-size/SSIM visual comparison across scan/document corpus |
| Office ⇄ PDF | LibreOffice headless isolated containers; dedicated PDF→Office reconstruction engine to assess separately | side-by-side layout fidelity, tables/fonts/charts tests |
| OCR scanned pages | Tesseract/OCRmyPDF server, browser light path only when competitive | multilingual character/word error rates, searchable text mapping |
| True text/image-object editing | PDF object-aware engine with font/subset handling and stable reflow; not equivalent to annotation overlay | object preservation, clipping/font/layout checks |
| Repair, encrypt/decrypt | qpdf engine (local WASM where robust or container runner) | encrypted sample corpus, structural validation |
| Redaction | reconstruct/remove underlying content and verify with text/object extraction | no recoverable redacted text, no unseen layers left |
| PDF/A, signatures | proven standards libraries and validation tools | veraPDF/cryptographic verification; do not advertise unsupported functionality |

**Infrastructure:** GitHub Pages only hosts static UI; Supabase is suitable for authentication, metadata and optional storage, but NOT a replacement for resource-limited containerized LibreOffice/OCRmyPDF/Ghostscript processing workers. Durable job queue, per-job isolated execution, content scanning, resource limits, short-lived storage, automatic expiry and secured signed access are mandatory for an upload-enabled backend. Deployment of backend requires explicit credentials and separate approved hosting; no pretend server functionality.

Review open-source dependency licenses and redistribution/AGPL/commercial options before shipping server engine bundles. Never route documents to third-party clouds without visible notice of processing provider, retention and relevant cost.

## Delivery gates

- **R0 (now)**: clean v2 interface architecture, full design tokens, responsive home/catalog, tool upload/workspace/result skeleton, real worker-backed vertical slice, no legacy CSS/controllers loaded.
- **R1**: 100% of currently implemented PDF operations accessible through the new shell. Performance, state/error handling and keyboard/mobile audited. Only then retire legacy view.
- **R2**: quality-critical server workers (first compression and Office conversion), architecture/protocol and actual hosted integration with secure job lifecycle.
- **R3**: object-aware advanced editor, form builder and robust OCR, redaction, PDF/A; full corpus fidelity and accessibility.
- **R4**: comprehensive polish: device matrix, localization, accessibility, performance budgets, user-study benchmarks, observability and reliability.

**Non-negotiable acceptance:** test output PDFs structurally and visually (not only UI screenshots); pass Chromium/Firefox/WebKit, 320/390/768/1440 widths, keyboard and screen reader, 200+ page performance, failures and cancellation, mobile Safari and Chrome manual checks, security review and production smoke suite. Do not merge the v2 branch or delete old files until replacement parity has passed. Gate by capabilities rather than calendar deadlines.
