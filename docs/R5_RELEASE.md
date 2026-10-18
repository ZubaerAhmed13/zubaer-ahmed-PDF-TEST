# R5 · v0.7.0 — preservation, security and performance

R5 extends the existing local processing flows. It adds a pre-export preservation panel to all PDF workspaces, a cancellable local structural inventory, raster-redaction resolution and region review, common resource limits and reproducible release packages. All 29 tools remain available. No document service, analytics or document persistence was added.

## Preservation evidence

`tests/r5OperationPreservation.test.ts` measures fourteen transformations independently with PDF.js as well as pdf-lib. The synthetic corpus includes fonts/selectable text, a vector path, link annotations, an outline destination, page labels, a filled form, an attachment, a private title and a minimal StructTreeRoot. `artifacts/r5/preservation.json` records exact outcomes. The structure root is a presence test, not PDF/UA or semantic reading-order certification. Existing R2 independent PyMuPDF tests retain embedded Unicode font, native-comment and crop/rotation evidence. Existing browser suites retain redaction pixel, qpdf, scan, image and workflow evidence.

| Tools / operation | Established behavior | Consequence shown before export |
|---|---|---|
| Merge, split, remove, extract, organize | Retained page text/font operators, vector paths and external URI link in corpus | Root bookmarks, labels, editable forms, attachments, metadata and tags are lost; complex annotation/internal-link references require review |
| Rotate, numbers, watermark, crop, annotate, visual signature | Corpus catalog keys, outline title, labels, attachment and form reopen; original page text/vector/link remain | Complex references and accessibility semantics uncertified; active content can remain; crop hides rather than removes |
| Metadata edit | Same corpus structural checks; Info properties intentionally edited | Standard Info editing does not sanitise XMP, attachments or hidden content |
| Forms fill | Corpus field/catalog retained; existing type-matrix and flatten tests retained | Optional flatten removes editability; XFA unsupported |
| Optimize | Structural-only corpus rewrite retains structures; existing JPEG/color fidelity tests retained | Eligible image recompression is lossy; unsupported cases skipped |
| Edit PDF | Existing R2 font/comment/crop independent checks retained | Added content does not repair original tagging, layout or existing-text semantics |
| Protect, unlock, repair | Existing browser qpdf reopen/geometry/text and malformed-xref corpus retained | Rewrite can invalidate signatures and preserve active content; recovery does not recreate missing bytes |
| OCR | Existing R4 rotated/CropBox/Unicode/original-pixel evidence retained | Approximate text layer; original tags not rebuilt for new text |
| Permanent redaction | Existing four-rotation/CropBox black-mask and adjacent-pixel tests retained | Every page becomes image-only; all original PDF objects and structures discarded |
| View, information, search/text, compare, extract images, PDF to images | Source stays unchanged; existing representation-specific checks retained | Exports do not inherit PDF structure; no PDF action execution or attachment opening |
| Images to PDF | Existing original embedding and reviewed correction paths retained | Creates new pages from pixels |
| Workflow, batch | Existing chained/queued export reopen tests retained | Every step's limits accumulate; later steps cannot restore lost structures |

The inventory traverses parsed indirect objects and nested dictionaries, including object streams handled by pdf-lib. It detects signature ByteRange/Contents, certification DocMDP, JavaScript/open/additional/launch/remote/form actions, embedded files, non-HTTPS URI actions and supported catalog structures. An empty signature field is not reported as signed. It never validates a signature, signer, trust chain or certification permission and is not a malware scanner. Encrypted, malformed or over-budget files are explicitly “inspection incomplete”; absence of detected structures is not proof of safety. Files and inventory results are retained in this tab only, with stale inspection cancelled on replacement/close.

PDF.js 4.10.38 is configured locally with eval disabled, XFA disabled, strict errors, an image limit and no worker fetch of external resources. DocFlow does not install the PDF scripting sandbox or execute attachment/link actions. Whole-document exports can retain original actions. Only full raster redaction deliberately discards original objects.

## Redaction review

Choose 72, approximately 115 (existing default), 150 or 300 requested DPI. Output is always capped at 2,200 pixels per dimension and 3.2 million pixels per page. Effective resolution and current-page RGBA canvas size are shown; requested 300 DPI is not promised when capped. Review areas by page and percentage bounds, jump to an area and remove individual areas. “Build export size preview” performs the real redaction and reports the exact resulting PDF byte count, without exposing a download. Apply publishes that same result. Changing the source, masks or resolution discards the preview. The existing informed-rasterization checkbox and mask expansion remain enforced.

## Declared resource envelope

| Boundary | Limit / behavior |
|---|---|
| Input | 150 MiB/file, 250 MiB combined per PDF worker request; redaction retains stricter 40 MiB/15-page limits |
| Structural inventory/worker preflight | 1–1,000 pages; 100,000 indirect objects; 250,000 visited containers; page MediaBox dimensions <=14,400 points; embedded image <=80 million pixels |
| Workers | At most four operation/inspection workers; each operation terminates at 120 seconds; cancellation terminates immediately, late messages ignored |
| PDF.js loading | Same byte/page bounds and 120-second loading deadline; owned parser worker terminates on abort/deadline, normal cleanup acknowledgement is capped at 500 ms; strict failure for oversized images rather than silently omitted output |
| Preview | Adaptive <=4 million pixels, <=3,000 pixels/dimension; thumbnails <=300,000 pixels, <=600/dimension, serial rendering; reader uses a visible window, organizer and overview retain at most 24 decoded thumbnail canvases; automatic metadata uses two cancellable jobs |
| Image export | <=16 million pixels and <=8,192 pixels/dimension per canvas, <=150 MiB encoded images before ZIP; native embedded-image extraction rejects oversize images rather than silently resampling; explicit cleanup on failure/cancel |
| OCR/compare/redaction | Existing 30 selected OCR pages/3 MP, first 50 comparison pages/bounded previews, 15 redaction pages/3.2 MP limits retained |

These are admission, canvas, concurrency and deadline controls, not a hard process-memory sandbox. pdf-lib/qpdf still need full input/output buffers and parsed objects. OPFS is not advertised as a streaming solution. qpdf must handle encrypted/damaged input itself; byte, worker and time limits apply, but structural admission cannot be established before repair/unlock. Main-thread encoding and library serialization cannot always be interrupted mid-call; cancelled results are never published. Browser documents can still be unusually expensive below the declared limits.

The lifecycle browser benchmark uses forty blank Letter pages and five open/render/close cycles. It measures application-owned live workers, Blob URLs and attached canvas pixels, with zero workers/canvas pixels and <=1 live URL after each close. This is not RSS/heap or physical-device memory certification. The existing 300-page mixed-dimension and three-page A4 300-DPI scan tests remain the larger-document evidence. No larger-device or hardware performance claim is made.

## Supply chain and release

`npm run verify:provenance` checks six vendored qpdf/font/license SHA-256 pins, exact direct dependency versions and all 254 lockfile package integrity/source records; it exports declared licenses without inventing missing ones. npm audit remains a release gate. No runtime dependencies were added.

`npm run release:artifact` creates a sorted ZIP with fixed timestamps, a per-file SHA-256 manifest, exact commit/version and archive checksum. CI builds and packages twice from the same revision, compares checksums, retains the exact ZIP/manifest and deploys the verified build. Reproducibility is scoped to the pinned lockfile, Node 22 and the same build environment/revision; cross-platform byte identity is not asserted.

Root application licensing is now explicitly `UNLICENSED`; this preserves the existing absence of a grant. An open-source/commercial license is still the owner's choice, recorded in LICENSE_STATUS.md. Third-party terms remain intact. SECURITY.md defines the update and verification process.

## Verification record

Local baseline: 94 unit tests. R5 local verification and browser/production outcomes are recorded in the release PR and Actions artifacts. Existing WebKit offline execution, real camera/device ergonomics and manual assistive-technology checks remain unverified; automated browser emulation is not a substitute. Do not infer arbitrary-PDF preservation or signature/PDF-A/PDF-UA certification from these fixtures.

R5 review fixes cover the legacy overview/metadata loaders, pending teardown deadlines, secondary repair verification, native image-extraction budgets, OCR and comparison render/text cancellation. Browser regressions exercise huge overview pages, native 9,000-pixel images, repair operator-list cancellation and 1,001-page rejection. Unit regressions hold parser load/teardown and render promises pending to prove prompt cancellation and canvas release.
