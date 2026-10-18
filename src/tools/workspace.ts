import { mountScanReview, scanControls } from './scanReview';
import { scanOptions, canvasBlob } from '../pdf/scanProcessing';
import { mountComparisonReview } from './comparisonReview';
import { addOutputSharing, addShareButton } from '../app/fileExport';
import { showDerivedFormPreview } from '../app/preEditPreview';
import { mountFormPageOverlay } from '../app/formPageOverlay';
import { workspaceRuntime } from '../app/workspaceRuntime';
import type { ToolDefinition } from './registry';
import type { InputFile, OperationResult, WorkerOperation } from '../pdf/types';
import { runWorkerOperation, type RunningOperation } from '../pdf/workerClient';
import { createPreview, pdfToImages, type PreviewController } from '../pdf/render';
import { mountVisualFormEditor, type InspectedFormField } from '../app/visualFormEditor';
import { mountSignaturePad } from '../app/signaturePad';

interface FileRecord {
  file: File;
  id: string;
}

const pdfOnly = new Set(['preview','merge','split','remove-pages','extract-pages','organize','rotate','page-numbers','watermark','pdf-to-images','forms','metadata','compress','crop','annotate','sign-visual','metadata-edit','text-search','ocr','compare']);
const THUMBNAIL_ROW_HEIGHT = 154;
const THUMBNAIL_OVERSCAN = 3;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character] ?? character));
}
function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB','MB','GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}
function optionMarkup(id: string): string {
  switch (id) {
    case 'split': return `<label>Split mode<select name="mode"><option value="ranges">Page ranges</option><option value="selected">Selected pages</option><option value="every">Every N pages</option><option value="individual">Individual pages</option></select></label><label>Ranges (separate outputs with semicolon)<input name="ranges" value="1-1" placeholder="1-10;11-25;26-40"></label><label>Selected pages<input name="pages" placeholder="1,3,5-8"></label><label>Every N pages<input name="every" type="number" min="1" value="5"></label>`;
    case 'remove-pages': return `<label>Pages to remove<input name="pages" placeholder="2,4,7-10" required></label><p class="help">The selected pages are omitted from a newly written PDF. At least one page must remain.</p>`;
    case 'extract-pages': return `<label>Pages to extract<input name="pages" placeholder="1,3,5-8" required></label><p class="help">Selected pages are copied structurally into a new PDF without intentional rasterization.</p>`;
    case 'organize': return `<label>New page order<input name="order" placeholder="1,2,4,3,5"></label><p class="help">Repeat a page number to duplicate it. Omit a page number to remove it. This migration preview uses a deterministic operation plan; drag-and-drop UI is still pending.</p>`;
    case 'rotate': return `<label>Apply to<select name="target"><option value="all">All pages</option><option value="odd">Odd pages</option><option value="even">Even pages</option><option value="selected">Selected pages</option></select></label><label>Selected pages<input name="pages" placeholder="1,3,5-8"></label><label>Rotation<select name="degrees"><option value="90">90° clockwise</option><option value="180">180°</option><option value="270">270° clockwise</option></select></label>`;
    case 'page-numbers': return `<label>Pages<input name="pages" placeholder="Blank = all pages"></label><label>Starting number<input name="start" type="number" value="1"></label><label>Format<select name="format"><option value="page-total">Page 1 of 20</option><option value="fraction">1 / 20</option><option value="page">Page 1</option><option value="number">1</option></select></label><label>Font size<input name="fontSize" type="number" min="6" max="72" value="11"></label><label>Bottom margin (pt)<input name="margin" type="number" min="4" value="24"></label>`;
    case 'watermark': return `<label>Watermark text<input name="text" value="CONFIDENTIAL"></label><label>Opacity<input name="opacity" type="number" min=".05" max="1" step=".05" value=".18"></label><label>Rotation<input name="rotation" type="number" min="-180" max="180" value="-35"></label><label>Font size<input name="fontSize" type="number" min="12" max="120" value="42"></label>`;
    case 'images-to-pdf': return `<section data-scan-review class="wide"></section><label>Page size<select name="pageSize"><option value="a4">A4</option><option value="letter">US Letter</option><option value="original">Fit to image dimensions</option></select></label><label>Orientation<select name="orientation"><option value="auto">Auto by image</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label><label>Page margin (pt)<input name="margin" type="number" min="0" max="150" value="24"></label><label class="check"><input type="checkbox" name="upscale"> Upscale small images to fit the page</label><p class="help">Images stay embedded without re-encoding; original-size pages assume 96 pixels per inch. Change orientation and margin before export.</p>`;
    case 'pdf-to-images': return `<label>Format<select name="format"><option value="png">PNG</option><option value="jpeg">JPEG</option></select></label><label>Render scale<select name="scale"><option value="1">1×</option><option value="1.5" selected>1.5×</option><option value="2">2×</option></select></label><p class="warning-text">Image export rasterizes pages and is intentionally lossy with respect to selectable text/vector structure.</p>`;
    case 'forms': return `<div class="form-inspector"><button type="button" class="secondary" data-inspect-form>Inspect form fields</button><div id="form-field-summary" class="help" role="status" aria-live="polite">Add a PDF form to discover editable fields. XFA documents are reported as unsupported.</div></div><section id="visual-form-editor" class="visual-form-editor" aria-label="Visual PDF form editor"></section><label class="check"><input name="flatten" type="checkbox"> Flatten fields after filling (removes interactive fields)</label><details class="visual-form-advanced"><summary>Advanced JSON values (optional)</summary><label class="wide">Form values as JSON<textarea name="values" rows="7" placeholder='{"CustomerName":"Example","Accepted":true}'></textarea></label><p class="help">For advanced users and compatibility with existing form workflows. Visual fields above update these values automatically.</p></details>`;
    case 'compress': return `<div class="notice"><strong>Limited structural optimization</strong><p>This does not claim professional image compression. It rewrites PDF structure with object streams and reports the before/after size. Images are not intentionally recompressed.</p></div>`;
    case 'preview': return `<p class="help">The PDF.js viewer keeps one full active-page canvas and a virtualized thumbnail window, so large page counts do not create a canvas for every page at once.</p>`;
    case 'metadata': return `<p class="help">Reads standard metadata locally. Encrypted/password-protected files are detected and reported instead of being mislabeled as readable.</p>`;
    case 'crop': return `<p class="warning-text">Cropping only hides visible content by adjusting the PDF CropBox. Hidden content is recoverable; this is NOT redaction.</p><label>Pages (blank = all)<input name="pages" placeholder="1,3-5"></label><label>Left margin (pt)<input name="left" type="number" min="0" max="5000" value="24"></label><label>Right margin (pt)<input name="right" type="number" min="0" max="5000" value="24"></label><label>Top margin (pt)<input name="top" type="number" min="0" max="5000" value="24"></label><label>Bottom margin (pt)<input name="bottom" type="number" min="0" max="5000" value="24"></label><p class="help">72 points = one inch. At least 18 points must remain in each dimension.</p>`;
    case 'metadata-edit': return `<p class="help">Blank fields preserve existing values. Choose Clear standard properties to empty the standard Info fields. XMP, attachments and hidden content are not sanitised.</p><label>Action<select name="action"><option value="edit">Edit properties</option><option value="clear">Clear standard properties</option></select></label><label>Title<input name="title" maxlength="512"></label><label>Author<input name="author" maxlength="512"></label><label>Subject<input name="subject" maxlength="512"></label><label>Keywords (comma separated)<input name="keywords" maxlength="1000"></label><label>Creator<input name="creator" maxlength="512"></label>`;
    case 'annotate': return `<p class="help">Adds visible marks to page content. These are NOT editable PDF comments, exact text highlights, or secure redactions.</p><label>Mark type<select name="kind"><option value="note">Text note</option><option value="highlight">Coloured highlight region</option><option value="rectangle">Outline rectangle</option></select></label><label>Text note<textarea name="text" maxlength="700" rows="3" placeholder="Review note"></textarea></label><label>Colour<input name="color" type="color" value="#efaa35"></label><label>Pages (blank = all)<input name="pages" placeholder="1,3-5"></label><label>X from left (%)<input name="posX" type="number" min="0" max="100" value="12"></label><label>Y from top (%)<input name="posY" type="number" min="0" max="100" value="12"></label><label>Width (%)<input name="markWidth" type="number" min="2" max="100" value="30"></label><label>Height (%)<input name="markHeight" type="number" min="1" max="100" value="12"></label><label>Note font (pt)<input name="fontSize" type="number" min="7" max="36" value="14"></label>`;
    case 'sign-visual': return `<p class="warning-text">A visible signature is not a certificate-backed cryptographic signature.</p><div id="signature-pad-host"></div><label>Typed signature (used if no drawing)<input name="signatureText" maxlength="150" autocomplete="off" placeholder="Your name"></label><label>Pages (blank = all)<input name="pages" placeholder="1"></label><label>X from left (%)<input name="posX" type="number" min="0" max="100" value="58"></label><label>Y from top (%)<input name="posY" type="number" min="0" max="100" value="82"></label><label>Width (%)<input name="markWidth" type="number" min="2" max="100" value="32"></label><label>Height (%)<input name="markHeight" type="number" min="1" max="100" value="10"></label><label>Typed font size (pt)<input name="fontSize" type="number" min="10" max="42" value="24"></label>`;
    case 'ocr': return `<div class="notice"><strong>Private, same-origin OCR</strong><p>English and German recognition run on your device. Prepare both language models in Help & offline for mixed-language offline recognition. Review important information; OCR can make mistakes.</p></div><label>Recognition language<select name="language"><option value="eng">English</option><option value="deu">German (Deutsch)</option><option value="eng+deu">English + German</option></select></label><label>Pages to recognize<input name="pages" placeholder="Blank = all; e.g. 2,4-6"></label><label>Maximum pages per run (1–30)<input name="maxPages" type="number" min="1" max="30" value="10"></label><label class="check"><input name="skipExistingText" type="checkbox" checked> Skip pages with existing selectable text</label><details class="wide"><summary>Rotation, deskew & cleanup review</summary><div class="scan-control-grid">${scanControls()}</div><label>Preview source page<input name="previewPage" type="number" min="1" value="1"></label><button type="button" class="secondary" data-ocr-preview>Review before / after</button><p data-ocr-preview-status role="status"></p><div data-ocr-preview-pair class="scan-review-pair"></div></details><p class="warning-text">The source scan remains visible. Correction settings affect recognition only; the invisible Unicode text layer is mapped back to the original scan. Preview your settings before running. The text layer is approximate and is not a tagged or accessible-document certification. Retry selected pages from your original input to avoid duplicate text layers.</p>`;
    case 'compare': return '<div class="notice"><strong>Private PDF comparison</strong><p>Add exactly two PDFs: first is A (original), second is B (revised). Pages are matched using selectable text or scan thumbnails. Inserted, deleted and moved pages are shown separately. Ambiguous matches are marked for review.</p></div><label>Comparison mode<select name="mode"><option value="both">Text + visual (recommended)</option><option value="text">Selectable text only</option><option value="visual">Visual pixels only</option></select></label><label>Maximum pages per document (1–50)<input name="maxPages" type="number" min="1" max="50" value="20"></label><label>Pixel difference threshold (0–255)<input name="threshold" type="number" min="0" max="255" value="34"></label><label>Changed area tolerance (%)<input name="tolerance" type="number" min="0" max="100" step="0.01" value="0.05"></label><p class="help">Higher thresholds ignore more visual differences. Downscaled rendering can miss small changes. Text changes remain visible regardless of visual tolerance; image-only pages need OCR for word changes.</p><section id="pdf-comparison-results" class="docflow-diff-results" aria-live="polite" aria-label="PDF comparison results"></section>';
    case 'text-search': return `<label>Find text<input name="query" type="search" maxlength="150" placeholder="Enter a phrase (optional)"></label><p class="help">Reads selectable text using PDF.js. Empty search extracts everything. Scanned images require OCR; no OCR is performed.</p><section id="text-search-matches" aria-label="Search results" aria-live="polite"></section>`;
    default: return '';
  }
}

function formOptions(form: HTMLFormElement): Record<string, unknown> {
  const data = new FormData(form);
  const options: Record<string, unknown> = {};
  for (const [key, value] of data.entries()) options[key] = value;
  form.querySelectorAll<HTMLInputElement>('input[type=number]').forEach((input) => {
    if (input.name && input.value !== '') options[input.name] = Number(input.value);
  });
  form.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((input) => { if (input.name) options[input.name] = input.checked; });
  return options;
}

async function readInputs(records: FileRecord[]): Promise<InputFile[]> {
  return Promise.all(records.map(async ({ file }) => ({ name: file.name, type: file.type, buffer: await file.arrayBuffer() })));
}

export function mountWorkspace(container: HTMLDivElement, tool: ToolDefinition): void {
  const runtime = workspaceRuntime(container);
  const accept = pdfOnly.has(tool.id) ? '.pdf,application/pdf' : '.jpg,.jpeg,.png,image/jpeg,image/png';
  container.innerHTML = `
    <div class="workspace-grid">
      <aside class="workspace-side">
        <p class="eyebrow">${escapeHtml(tool.category.toUpperCase())}</p>
        <h2>${escapeHtml(tool.name)}</h2>
        <p>${escapeHtml(tool.description)}</p>
        <div class="quality-box"><strong>${tool.quality}</strong><span>${tool.quality === 'Lossless' ? 'Existing page structure is preserved where the operation allows it.' : tool.quality === 'Potentially lossy' ? 'This operation can change representation or image quality.' : 'No export quality change unless you run another operation.'}</span></div>
        <div class="privacy-box"><strong>Local processing</strong><span>Your documents are processed on this device.</span></div>
      </aside>
      <section class="workspace-main">
        <div class="drop-zone" tabindex="0" role="button" aria-label="Choose files or drop files here">
          <strong>Drop ${tool.multipleFiles ? 'files' : 'a file'} here</strong>
          <span>or choose from your device</span>
          <input id="workspace-file" type="file" aria-label="Source files" accept="${accept}" ${tool.multipleFiles ? 'multiple' : ''}>
        </div>
        <div id="memory-warning" class="memory-warning" hidden></div>
        <div id="file-list" class="file-list" aria-live="polite"></div>
        <form id="tool-options" class="tool-options">${optionMarkup(tool.id)}</form>
        <div id="preview-area"></div>
        <div class="operation-status" aria-live="polite">
          <div class="status-line"><span id="stage">Ready</span><span id="percent">0%</span></div>
          <progress id="progress" max="100" value="0"></progress>
          <div id="error" class="error-box" role="alert" hidden></div>
        </div>
        <div class="workspace-actions">
          <button class="secondary" id="cancel-operation" type="button" disabled>Cancel</button>
          <button class="primary" id="run-operation" type="button">Run ${escapeHtml(tool.name)}</button>
        </div>
        <div id="result" class="result-area"></div>
      </section>
    </div>
  `;

  const input = container.querySelector<HTMLInputElement>('#workspace-file');
  const drop = container.querySelector<HTMLDivElement>('.drop-zone');
  const list = container.querySelector<HTMLDivElement>('#file-list');
  const warning = container.querySelector<HTMLDivElement>('#memory-warning');
  const optionsForm = container.querySelector<HTMLFormElement>('#tool-options');
  const run = container.querySelector<HTMLButtonElement>('#run-operation');
  const cancel = container.querySelector<HTMLButtonElement>('#cancel-operation');
  const stage = container.querySelector<HTMLSpanElement>('#stage');
  const percent = container.querySelector<HTMLSpanElement>('#percent');
  const progressBar = container.querySelector<HTMLProgressElement>('#progress');
  const errorBox = container.querySelector<HTMLDivElement>('#error');
  const resultArea = container.querySelector<HTMLDivElement>('#result');
  const previewArea = container.querySelector<HTMLDivElement>('#preview-area');
  if (!input || !drop || !list || !warning || !optionsForm || !run || !cancel || !stage || !percent || !progressBar || !errorBox || !resultArea || !previewArea) return;

  let records: FileRecord[] = [];
  let running: RunningOperation | null = null;
  let mainCancelled = false;
  let disposed = false;
  let previewController: PreviewController | null = null;
  let previewUiCleanup: (() => void) | null = null;
  let objectUrls: string[] = [];
  let activeAbort: AbortController | null = null;
  const compareResults = container.querySelector<HTMLElement>('#pdf-comparison-results');
  const signatureHost = container.querySelector<HTMLElement>('#signature-pad-host');
  const signaturePad = signatureHost ? mountSignaturePad(signatureHost) : null;
  const textResults = container.querySelector<HTMLElement>('#text-search-matches');
  let inspectionGeneration = 0;
  let inspectionTimer: number | null = null;
  let inspectionRun: RunningOperation | null = null;
  let formOverlay: { dispose(): void } | null = null;
  let visualEditor: ReturnType<typeof mountVisualFormEditor> | null = null;
  const formSummary = container.querySelector<HTMLElement>('#form-field-summary');
  const formInspector = container.querySelector<HTMLButtonElement>('[data-inspect-form]');
  const visualHost = container.querySelector<HTMLElement>('#visual-form-editor');
  const advancedFormValues = optionsForm.querySelector<HTMLTextAreaElement>('textarea[name=values]');
  let formValuesTouched = false;
  advancedFormValues?.addEventListener('input', () => { formValuesTouched = true; });

  const beforeUnload = (event: BeforeUnloadEvent): void => {
    if (!records.length && !running) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', beforeUnload);

  const clearUrls = (): void => { objectUrls.forEach((url) => URL.revokeObjectURL(url)); objectUrls = []; };
  const setError = (message = ''): void => {
    errorBox.hidden = !message;
    errorBox.textContent = message;
  };
  const setProgress = (message: string, value: number): void => {
    stage.textContent = message;
    progressBar.value = value;
    percent.textContent = `${Math.round(value)}%`;
  };
  const renderFiles = (): void => {
    runtime.inputs(records.map(record => record.file));
    list.innerHTML = records.map(({file,id}, index) => `<div class="file-row"><span><strong>${escapeHtml(file.name)}</strong><small>${humanBytes(file.size)}</small></span><button type="button" data-remove="${id}" aria-label="Remove ${escapeHtml(file.name)}">Remove</button>${tool.id === 'images-to-pdf' ? `<span class="order">#${index + 1}</span><button type="button" data-up="${id}" aria-label="Move ${escapeHtml(file.name)} up" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-down="${id}" aria-label="Move ${escapeHtml(file.name)} down" ${index === records.length - 1 ? 'disabled' : ''}>↓</button>` : ''}</div>`).join('');
    if (tool.id === 'images-to-pdf') queueMicrotask(() => { if (!disposed) container.dispatchEvent(new CustomEvent('docflow-source-files', { bubbles: true, detail: records.slice() })); });
    const totalBytes = records.reduce((sum, record) => sum + record.file.size, 0);
    const memory = navigator as Navigator & { deviceMemory?: number };
    const risky = totalBytes > 250 * 1024 * 1024 || ((memory.deviceMemory ?? 8) <= 4 && totalBytes > 100 * 1024 * 1024);
    warning.hidden = !risky;
    if (risky) warning.textContent = `Large input (${humanBytes(totalBytes)}). This migration removes the old 20 MB cap, but current pdf-lib operations still buffer documents in worker memory. Process selected pages or smaller batches if your browser is memory constrained.`;
  };
  const addFiles = (incoming: FileList | File[]): void => {
    const candidates = [...incoming];
    const valid = candidates.filter((file) => pdfOnly.has(tool.id) ? (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) : (/image\/(png|jpeg)/.test(file.type) || /\.png$|\.jpe?g$/i.test(file.name)));
    if (valid.length !== candidates.length) setError('One or more files were rejected because their type is not supported by this tool.');
    else setError();
    if (!tool.multipleFiles) records = valid.slice(0, 1).map((file) => ({file,id:crypto.randomUUID()}));
    else records.push(...valid.map((file) => ({file,id:crypto.randomUUID()})));
    renderFiles();
    scanReview?.refresh();
    if (tool.id === 'forms') {
      inspectionGeneration += 1;
      inspectionRun?.cancel();
      if (inspectionTimer !== null) window.clearTimeout(inspectionTimer);
      formOverlay?.dispose(); formOverlay = null;
    visualEditor?.dispose();
      visualEditor = null;
      if (advancedFormValues) advancedFormValues.value = '{}';
      formValuesTouched = false;
      if (formSummary) formSummary.textContent = records.length ? 'Discovering form fields locally…' : 'Add a PDF form to discover editable fields.';
      if (records.length) inspectionTimer = window.setTimeout(() => {
        inspectionTimer = null;
        void inspectFormFields();
      }, 250);
    }
  };

  const scanHost = container.querySelector<HTMLElement>('[data-scan-review]');
  const scanReview = scanHost ? mountScanReview(scanHost, () => records.map(r => r.file), addFiles) : null;
  let ocrPreviewGeneration = 0;
  let ocrPreviewUrls: string[] = [];
  container.querySelector('[data-ocr-preview]')?.addEventListener('click', () => {
    const file = records[0]?.file, generation = ++ocrPreviewGeneration;
    const status = container.querySelector<HTMLElement>('[data-ocr-preview-status]')!;
    if (!file) { status.textContent = 'Choose a PDF first.'; return; }
    status.textContent = 'Preparing review…';
    void (async () => {
      const { ocrPreview } = await import('../pdf/localOcr');
      const cfg = formOptions(optionsForm), { original, corrected } = await ocrPreview(await file.arrayBuffer(), Number(cfg.previewPage ?? 1), scanOptions(cfg));
      try {
        const blobs = await Promise.all([canvasBlob(original), canvasBlob(corrected)]);
        if (disposed || generation !== ocrPreviewGeneration || records[0]?.file !== file) return;
        const pair = container.querySelector<HTMLElement>('[data-ocr-preview-pair]')!; ocrPreviewUrls.forEach(url => URL.revokeObjectURL(url)); ocrPreviewUrls = []; pair.replaceChildren();
        blobs.forEach((blob, i) => { const figure = document.createElement('figure'), img = document.createElement('img'), caption = document.createElement('figcaption'); img.src = URL.createObjectURL(blob); ocrPreviewUrls.push(img.src); img.alt = i ? 'After recognition preprocessing' : 'Before recognition preprocessing'; caption.textContent = i ? 'After · used for recognition' : 'Before · source remains visible in PDF'; figure.append(img, caption); pair.append(figure); });
        status.textContent = 'Review ready. These settings apply to every selected page.';
      } finally { original.width = original.height = corrected.width = corrected.height = 1; }
    })().catch((error: unknown) => { if (!disposed && generation === ocrPreviewGeneration) status.textContent = error instanceof Error ? error.message : 'Preview failed.'; });
  });

  input.addEventListener('change', () => { if (input.files) addFiles(input.files); input.value = ''; });
  drop.addEventListener('click', (event) => { if ((event.target as HTMLElement) !== input) input.click(); });
  drop.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); } });
  for (const eventName of ['dragenter','dragover']) drop.addEventListener(eventName, (event) => { event.preventDefault(); drop.classList.add('dragging'); });
  for (const eventName of ['dragleave','drop']) drop.addEventListener(eventName, (event) => { event.preventDefault(); drop.classList.remove('dragging'); });
  drop.addEventListener('drop', (event) => { if (event.dataTransfer?.files) addFiles(event.dataTransfer.files); });
  list.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('button');
    const move = target?.dataset.up ?? target?.dataset.down;
    if (move) { const index = records.findIndex(r => r.id === move), next = index + (target?.dataset.up ? -1 : 1); if (index >= 0 && next >= 0 && next < records.length) { [records[index], records[next]] = [records[next]!, records[index]!]; renderFiles(); scanReview?.refresh(); } return; }
    const id = target?.dataset.remove;
    if (!id) return;
    records = records.filter((record) => record.id !== id);
    renderFiles();
    scanReview?.refresh();
    if (tool.id === 'forms') {
      inspectionGeneration += 1;
      inspectionRun?.cancel();
      formOverlay?.dispose(); formOverlay = null;
    visualEditor?.dispose();
      visualEditor = null;
      if (formSummary) formSummary.textContent = 'Select a form to discover its editable fields.';
    }
  });

  const renderOutputs = (result: OperationResult): void => {
    if (disposed || mainCancelled) return;
    runtime.result(result);
    clearUrls();
    const info = result.info ? `<pre class="info-result">${escapeHtml(JSON.stringify(result.info, null, 2))}</pre>` : '';
    const downloads = result.outputs.map((output) => {
      const blob = new Blob([output.buffer], { type: output.type });
      const url = URL.createObjectURL(blob);
      objectUrls.push(url);
      return `<a class="download" href="${url}" download="${escapeHtml(output.name)}">Download ${escapeHtml(output.name)} <span>${humanBytes(blob.size)}</span></a>`;
    }).join('');
    resultArea.innerHTML = `${info}${downloads}`;
    addOutputSharing(resultArea, result.outputs);
  };

  const runPreview = async (): Promise<void> => {
    const file = records[0]?.file;
    if (!file) throw new Error('Choose a PDF first.');
    previewUiCleanup?.();
    previewUiCleanup = null;
    await previewController?.destroy();
    previewController = null;
    previewArea.innerHTML = `<div class="viewer-toolbar"><button type="button" data-page="prev">Previous</button><span id="viewer-status">Opening PDF…</span><button type="button" data-page="next">Next</button></div><div class="viewer-layout"><aside class="thumbnail-rail" aria-label="Page thumbnails"><div class="thumbnail-track"></div></aside><div class="canvas-shell"><canvas id="pdf-canvas"></canvas></div></div>`;
    const canvas = previewArea.querySelector<HTMLCanvasElement>('#pdf-canvas');
    const viewerStatus = previewArea.querySelector<HTMLElement>('#viewer-status');
    const toolbar = previewArea.querySelector<HTMLElement>('.viewer-toolbar');
    const rail = previewArea.querySelector<HTMLElement>('.thumbnail-rail');
    const track = previewArea.querySelector<HTMLElement>('.thumbnail-track');
    if (!canvas || !viewerStatus || !toolbar || !rail || !track) return;

    const controller = await createPreview(await file.arrayBuffer(), canvas, viewerStatus);
    previewController = controller;
    track.style.height = `${controller.pageCount * THUMBNAIL_ROW_HEIGHT}px`;
    track.dataset.pageCount = String(controller.pageCount);
    let current = 1;
    let windowGeneration = 0;
    let renderFrame = 0;

    const markCurrent = (): void => {
      track.querySelectorAll<HTMLElement>('.thumbnail-item[aria-current]').forEach((item) => item.removeAttribute('aria-current'));
      track.querySelector<HTMLElement>(`.thumbnail-item[data-thumbnail-page="${current}"]`)?.setAttribute('aria-current', 'page');
    };

    const renderThumbnailWindow = (): void => {
      renderFrame = 0;
      const generation = ++windowGeneration;
      controller.cancelThumbnails();
      const viewportHeight = Math.max(rail.clientHeight, THUMBNAIL_ROW_HEIGHT * 3);
      const firstVisible = Math.floor(rail.scrollTop / THUMBNAIL_ROW_HEIGHT) + 1;
      const start = Math.max(1, firstVisible - THUMBNAIL_OVERSCAN);
      const visibleRows = Math.ceil(viewportHeight / THUMBNAIL_ROW_HEIGHT) + THUMBNAIL_OVERSCAN * 2;
      const end = Math.min(controller.pageCount, start + visibleRows - 1);
      const fragment = document.createDocumentFragment();
      for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'thumbnail-item';
        button.dataset.thumbnailPage = String(pageNumber);
        button.dataset.thumbnailState = 'idle';
        button.setAttribute('aria-label', `View page ${pageNumber}`);
        if (pageNumber === current) button.setAttribute('aria-current', 'page');
        button.style.top = `${(pageNumber - 1) * THUMBNAIL_ROW_HEIGHT + 4}px`;
        button.innerHTML = `<canvas aria-hidden="true"></canvas><span class="thumbnail-label">Page ${pageNumber}</span>`;
        fragment.append(button);
      }
      track.replaceChildren(fragment);
      const buttons = [...track.querySelectorAll<HTMLButtonElement>('.thumbnail-item')];
      void (async () => {
        for (const button of buttons) {
          if (generation !== windowGeneration || previewController !== controller) return;
          const pageNumber = Number(button.dataset.thumbnailPage);
          const thumbnailCanvas = button.querySelector<HTMLCanvasElement>('canvas');
          if (!thumbnailCanvas) continue;
          button.dataset.thumbnailState = 'rendering';
          try {
            const completed = await controller.renderThumbnail(pageNumber, thumbnailCanvas);
            if (generation !== windowGeneration || !button.isConnected) return;
            button.dataset.thumbnailState = completed ? 'rendered' : 'idle';
          } catch {
            if (button.isConnected) button.dataset.thumbnailState = 'error';
          }
        }
      })();
    };

    const scheduleThumbnailWindow = (): void => {
      if (renderFrame) cancelAnimationFrame(renderFrame);
      renderFrame = requestAnimationFrame(renderThumbnailWindow);
    };

    const ensureThumbnailVisible = (pageNumber: number): void => {
      const top = (pageNumber - 1) * THUMBNAIL_ROW_HEIGHT;
      const bottom = top + THUMBNAIL_ROW_HEIGHT;
      if (top < rail.scrollTop || bottom > rail.scrollTop + rail.clientHeight) {
        rail.scrollTop = Math.max(0, top - Math.max(0, (rail.clientHeight - THUMBNAIL_ROW_HEIGHT) / 2));
      }
    };

    const showPage = async (pageNumber: number, revealThumbnail: boolean): Promise<void> => {
      current = Math.max(1, Math.min(controller.pageCount, pageNumber));
      if (revealThumbnail) ensureThumbnailVisible(current);
      scheduleThumbnailWindow();
      await controller.render(current);
      markCurrent();
    };

    const onScroll = (): void => scheduleThumbnailWindow();
    const onRailClick = (event: Event): void => {
      const item = (event.target as HTMLElement).closest<HTMLElement>('[data-thumbnail-page]');
      if (!item?.dataset.thumbnailPage) return;
      void showPage(Number(item.dataset.thumbnailPage), false);
    };
    const onToolbarClick = (event: Event): void => {
      const direction = (event.target as HTMLElement).closest<HTMLElement>('[data-page]')?.dataset.page;
      if (!direction) return;
      void showPage(current + (direction === 'next' ? 1 : -1), true);
    };

    rail.addEventListener('scroll', onScroll, { passive: true });
    rail.addEventListener('click', onRailClick);
    toolbar.addEventListener('click', onToolbarClick);
    previewUiCleanup = () => {
      windowGeneration += 1;
      if (renderFrame) cancelAnimationFrame(renderFrame);
      controller.cancelThumbnails();
      rail.removeEventListener('scroll', onScroll);
      rail.removeEventListener('click', onRailClick);
      toolbar.removeEventListener('click', onToolbarClick);
    };

    await showPage(1, true);
  };

  const execute = async (): Promise<void> => {
    inspectionGeneration += 1;
    if (inspectionTimer !== null) window.clearTimeout(inspectionTimer);
    inspectionRun?.cancel();
    if (!records.length) { setError(`Choose ${tool.multipleFiles ? 'files' : 'a file'} first.`); return; }
    if (tool.id === 'compare' && records.length !== 2) { setError('Choose exactly two PDFs to compare.'); return; }
    if (['ocr', 'compare', 'images-to-pdf'].includes(tool.id) && !optionsForm.reportValidity()) return;
    setError();
    clearUrls();
    resultArea.replaceChildren();
    compareResults?.replaceChildren();
    mainCancelled = false;
    runtime.busy(true);
    run.disabled = true;
    cancel.disabled = false;
    setProgress('Preparing document', 4);
    try {
      if (tool.id === 'ocr') {
        const { ocrPdf } = await import('../pdf/localOcr');
        const cfg = formOptions(optionsForm);
        activeAbort = new AbortController();
        if (mainCancelled) activeAbort.abort();
        const report = await ocrPdf(await records[0]!.file.arrayBuffer(), {
          language: cfg.language === 'eng+deu' ? 'eng+deu' : cfg.language === 'deu' ? 'deu' : 'eng',
          pages: String(cfg.pages ?? ''), preprocessing: scanOptions(cfg),
          maxPages: Number(cfg.maxPages ?? 10),
          skipExistingText: cfg.skipExistingText !== false
        }, (done, total, note) => {
          if (!mainCancelled) setProgress(note, Math.min(96, 4 + (done / total) * 91));
        }, activeAbort.signal);
        if (mainCancelled) throw new DOMException('OCR cancelled', 'AbortError');
        renderOutputs(report.output);
        setProgress('OCR complete: ' + report.recognizedPages + ' page(s) processed', 100);
        return;
      }
      if (tool.id === 'compare') {
        const { comparePdfs } = await import('../pdf/pdfComparison');
        const cfg = formOptions(optionsForm);
        const mode = cfg.mode === 'visual' ? 'visual' : cfg.mode === 'text' ? 'text' : 'both';
        const summary = await comparePdfs(
          await records[0]!.file.arrayBuffer(), await records[1]!.file.arrayBuffer(),
          { mode, maxPages: Number(cfg.maxPages ?? 20), threshold: Number(cfg.threshold ?? 34), tolerance: Number(cfg.tolerance ?? .05) },
          (done, total) => { if (!mainCancelled) setProgress('Comparing page ' + done + ' of ' + total, Math.min(96, 4 + done / total * 91)); },
          () => mainCancelled
        );
        if (mainCancelled) throw new DOMException('Comparison cancelled', 'AbortError');
        if (compareResults) mountComparisonReview(compareResults, summary, objectUrls);
        const reportUrl = URL.createObjectURL(summary.report);
        objectUrls.push(reportUrl);
        const link = document.createElement('a');
        link.className = 'download';
        link.href = reportUrl;
        link.download = 'pdf-comparison-report.txt';
        link.textContent = 'Download comparison report';
        resultArea.replaceChildren(link);
        addShareButton(link, summary.report);
        const htmlLink = document.createElement('a'); htmlLink.className = 'download'; htmlLink.href = URL.createObjectURL(summary.htmlReport); objectUrls.push(htmlLink.href); htmlLink.download = 'pdf-comparison-report.html'; htmlLink.textContent = 'Download navigable HTML report'; resultArea.append(htmlLink); addShareButton(htmlLink, summary.htmlReport);
        setProgress('Comparison complete', 100);
        return;
      }
      if (tool.id === 'text-search') {
        const { extractAndSearchText } = await import('../pdf/textExtraction');
        const query = String(formOptions(optionsForm).query ?? '');
        const scan = await extractAndSearchText(await records[0]!.file.arrayBuffer(), query, (done, total) => setProgress('Reading page ' + done + ' of ' + total, (done / total) * 95), () => mainCancelled);
        if (mainCancelled) throw new DOMException('Operation cancelled', 'AbortError');
        renderOutputs(scan.result);
        if (textResults) {
          textResults.replaceChildren();
          const heading = document.createElement('p');
          heading.textContent = query.trim() ? scan.hits.length + ' page(s) with matches' : 'All selectable text ready for download.';
          textResults.append(heading);
          for (const hit of scan.hits.slice(0, 120)) {
            const item = document.createElement('p');
            item.className = 'docflow-text-hit';
            item.textContent = 'Page ' + hit.page + ' (' + hit.count + '): ' + hit.sample;
            textResults.append(item);
          }
          if (scan.hits.length > 120) textResults.append(document.createTextNode('Showing the first 120 matching pages.'));
          if (scan.scannedPages) textResults.append(document.createTextNode(' ' + scan.scannedPages + ' page(s) had no selectable text. OCR may be needed.'));
        }
        setProgress('Complete', 100);
        return;
      }
      if (tool.id === 'preview') {
        await runPreview();
        setProgress('Preview ready', 100);
        return;
      }
      if (tool.id === 'pdf-to-images') {
        const options = formOptions(optionsForm);
        const format = options.format === 'jpeg' ? 'jpeg' : 'png';
        const scale = typeof options.scale === 'number' ? options.scale : Number(options.scale ?? 1.5);
        const blob = await pdfToImages(await records[0]!.file.arrayBuffer(), format, scale, (done,total) => setProgress(`Rendering page ${done} of ${total}`, (done/total)*95), () => mainCancelled);
        if (mainCancelled) throw new DOMException('Operation cancelled', 'AbortError');
        const url = URL.createObjectURL(blob); objectUrls.push(url);
        resultArea.innerHTML = `<a class="download" href="${url}" download="pdf-images.zip">Download pdf-images.zip <span>${humanBytes(blob.size)}</span></a>`;
        addShareButton(resultArea.querySelector<HTMLAnchorElement>('a[download]')!, blob);
        setProgress('Complete', 100);
        return;
      }
      const operation = (tool.id === 'forms' ? 'forms-fill' : tool.id === 'compress' ? 'optimize' : tool.id) as WorkerOperation;
      if (scanReview) activeAbort = new AbortController();
      const exportFiles = scanReview ? await scanReview.inputs(activeAbort!.signal, (done, total) => setProgress('Correcting photo ' + done + ' of ' + total, done / total * 40)) : records.map(r => r.file);
      const workerFiles = await Promise.all(exportFiles.map(async file => ({ name: file.name, type: file.type, buffer: await file.arrayBuffer() })));
      if (mainCancelled) throw new DOMException('Operation cancelled', 'AbortError');
      const selectedOptions = formOptions(optionsForm);
      if (tool.id === 'split' && runtime.sessionActive()) selectedOptions.individualPdfResults = true;
      if (tool.id === 'sign-visual') selectedOptions.signaturePng = signaturePad?.getData() ?? '';
      running = runWorkerOperation(operation, workerFiles, selectedOptions, (update) => setProgress(update.message, Math.min(96, update.percent)));
      const result = await running.result;
      renderOutputs(result);
      setProgress('Complete', 100);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') { setProgress('Cancelled', 0); setError('Operation cancelled.'); }
      else if (error instanceof Error) { setError(`${error.name !== 'Error' ? `${error.name}: ` : ''}${error.message}`); setProgress('Failed', 0); }
      else { setError('The operation failed.'); setProgress('Failed', 0); }
    } finally {
      runtime.busy(false);
      running = null;
      activeAbort = null;
      run.disabled = false;
      cancel.disabled = true;
    }
  };

  cancel.addEventListener('click', () => { mainCancelled = true; activeAbort?.abort(); running?.cancel(); });
  run.addEventListener('click', () => { void execute(); });

  async function inspectFormFields(): Promise<void> {
    const generation = ++inspectionGeneration;
    inspectionRun?.cancel();
    if (!records.length) { setError('Choose a PDF form first.'); return; }
    setError();
    if (formInspector) formInspector.disabled = true;
    if (formSummary) formSummary.textContent = 'Analysing form fields locally…';
    try {
        const workerFiles = await readInputs(records);
        const inspect = runWorkerOperation('forms-inspect', workerFiles, {}, (update) => { if (generation === inspectionGeneration) setProgress(update.message, update.percent); });
        inspectionRun = inspect;
        const result = await inspect.result;
        if (generation !== inspectionGeneration) return;
        const summary = container.querySelector<HTMLElement>('#form-field-summary');
        const textarea = advancedFormValues;
        if (summary && result.info) {
          const fieldsText = typeof result.info.fields === 'string' ? result.info.fields : '[]';
          const fields = JSON.parse(fieldsText) as InspectedFormField[];
          summary.textContent = `${fields.length} supported field(s) · edit visually or use Advanced JSON`;
          formOverlay?.dispose(); formOverlay = null;
    visualEditor?.dispose();
          visualEditor = null;
          if (visualHost && textarea) { visualEditor = mountVisualFormEditor(visualHost, textarea, fields, !formValuesTouched); formOverlay = mountFormPageOverlay(container, textarea, fields, async flattened => {
            const source = records[0]?.file;
            if (!source) return;
            if (!flattened) { await showDerivedFormPreview(container, source); return; }
            mainCancelled = false; runtime.busy(true); run!.disabled = true; cancel!.disabled = false;
            try {
              const files = await readInputs(records);
              if (disposed || mainCancelled || records[0]?.file !== source) return;
              running = runWorkerOperation('forms-fill', files, { values: textarea.value, flatten: true }, () => {});
              const result = await running.result;
              if (disposed || mainCancelled || records[0]?.file !== source) return;
              const output = result.outputs[0]!;
              await showDerivedFormPreview(container, new File([output.buffer], output.name, { type: output.type }), true);
              setProgress('Flattened appearance preview ready', 100);
            } finally { if (!disposed) { runtime.busy(false); run!.disabled = false; cancel!.disabled = true; running = null; } }
          }); }
        }
        setProgress('Form inspection complete', 100);
        container.dispatchEvent(new CustomEvent('docflow-form-ready'));
      } catch (error) {
        if (generation !== inspectionGeneration) return;
        const message = error instanceof Error ? `${error.name !== 'Error' ? `${error.name}: ` : ''}${error.message}` : 'Form inspection failed.';
        if (formSummary) formSummary.textContent = message;
        setError(message);
        setProgress('Failed', 0);
      } finally {
        if (generation === inspectionGeneration) {
          inspectionRun = null;
          if (formInspector) formInspector.disabled = false;
        }
      }
  }
  formInspector?.addEventListener('click', () => {
    if (inspectionTimer !== null) window.clearTimeout(inspectionTimer);
    inspectionTimer = null;
    void inspectFormFields();
  });

  container.addEventListener('docflow-cleanup', () => {
    disposed = true; scanReview?.dispose(); ocrPreviewGeneration++; ocrPreviewUrls.forEach(url => URL.revokeObjectURL(url));
    mainCancelled = true;
    activeAbort?.abort();
    inspectionGeneration += 1;
    if (inspectionTimer !== null) window.clearTimeout(inspectionTimer);
    inspectionRun?.cancel();
    formOverlay?.dispose(); formOverlay = null;
    visualEditor?.dispose();
    signaturePad?.dispose();
    running?.cancel();
    clearUrls();
    previewUiCleanup?.();
    previewUiCleanup = null;
    void previewController?.destroy();
    previewController = null;
    window.removeEventListener('beforeunload', beforeUnload);
  }, { once: true });
}
