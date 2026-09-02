import type { ToolDefinition } from './registry';
import type { InputFile, OperationResult, WorkerOperation } from '../pdf/types';
import { runWorkerOperation, type RunningOperation } from '../pdf/workerClient';
import { createPreview, pdfToImages, type PreviewController } from '../pdf/render';

interface FileRecord {
  file: File;
  id: string;
}

const pdfOnly = new Set(['preview','merge','split','remove-pages','extract-pages','organize','rotate','page-numbers','watermark','pdf-to-images','forms','metadata','compress']);

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
    case 'images-to-pdf': return `<label>Page margin (pt)<input name="margin" type="number" min="0" value="24"></label><p class="help">JPEG and PNG are embedded into A4 pages. Source pixels are not re-encoded by DocFlow before embedding.</p>`;
    case 'pdf-to-images': return `<label>Format<select name="format"><option value="png">PNG</option><option value="jpeg">JPEG</option></select></label><label>Render scale<select name="scale"><option value="1">1×</option><option value="1.5" selected>1.5×</option><option value="2">2×</option></select></label><p class="warning-text">Image export rasterizes pages and is intentionally lossy with respect to selectable text/vector structure.</p>`;
    case 'forms': return `<div class="form-inspector"><button type="button" class="secondary" data-inspect-form>Inspect form fields</button><div id="form-field-summary" class="help">Inspect first to distinguish supported AcroForm fields from XFA or documents without fields.</div></div><label class="wide">Field values (JSON)<textarea name="values" rows="7" placeholder='{"CustomerName":"Example","Accepted":true}'></textarea></label><label class="check"><input name="flatten" type="checkbox"> Flatten fields after filling (destructive)</label>`;
    case 'compress': return `<div class="notice"><strong>Limited structural optimization</strong><p>This does not claim professional image compression. It rewrites PDF structure with object streams and reports the before/after size. Images are not intentionally recompressed.</p></div>`;
    case 'preview': return `<p class="help">The viewer renders one active page at a time with the PDF.js worker enabled. This avoids creating full-resolution canvases for every page.</p>`;
    case 'metadata': return `<p class="help">Reads standard metadata locally. Encrypted/password-protected files are detected and reported instead of being mislabeled as readable.</p>`;
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
  const accept = pdfOnly.has(tool.id) ? '.pdf,application/pdf' : '.jpg,.jpeg,.png,image/jpeg,image/png';
  container.innerHTML = `
    <div class="workspace-grid">
      <aside class="workspace-side">
        <p class="eyebrow">${escapeHtml(tool.category.toUpperCase())}</p>
        <h2>${escapeHtml(tool.name)}</h2>
        <p>${escapeHtml(tool.description)}</p>
        <div class="quality-box"><strong>${tool.quality}</strong><span>${tool.quality === 'Lossless' ? 'Existing page structure is preserved where the operation allows it.' : tool.quality === 'Potentially lossy' ? 'This operation can change representation or image quality.' : 'No export quality change unless you run another operation.'}</span></div>
        <div class="privacy-box"><strong>Local processing</strong><span>No remote PDF-processing API is configured in this migration.</span></div>
      </aside>
      <section class="workspace-main">
        <div class="drop-zone" tabindex="0" role="button" aria-label="Choose files or drop files here">
          <strong>Drop ${tool.multipleFiles ? 'files' : 'a file'} here</strong>
          <span>or choose from your device</span>
          <input id="workspace-file" type="file" accept="${accept}" ${tool.multipleFiles ? 'multiple' : ''}>
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
  let previewController: PreviewController | null = null;
  let objectUrls: string[] = [];

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
    list.innerHTML = records.map(({file,id}, index) => `<div class="file-row"><span><strong>${escapeHtml(file.name)}</strong><small>${humanBytes(file.size)}</small></span><button type="button" data-remove="${id}" aria-label="Remove ${escapeHtml(file.name)}">Remove</button>${tool.multipleFiles ? `<span class="order">#${index + 1}</span>` : ''}</div>`).join('');
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
  };

  input.addEventListener('change', () => { if (input.files) addFiles(input.files); input.value = ''; });
  drop.addEventListener('click', (event) => { if ((event.target as HTMLElement) !== input) input.click(); });
  drop.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); } });
  for (const eventName of ['dragenter','dragover']) drop.addEventListener(eventName, (event) => { event.preventDefault(); drop.classList.add('dragging'); });
  for (const eventName of ['dragleave','drop']) drop.addEventListener(eventName, (event) => { event.preventDefault(); drop.classList.remove('dragging'); });
  drop.addEventListener('drop', (event) => { if (event.dataTransfer?.files) addFiles(event.dataTransfer.files); });
  list.addEventListener('click', (event) => {
    const id = (event.target as HTMLElement).closest<HTMLElement>('[data-remove]')?.dataset.remove;
    if (!id) return;
    records = records.filter((record) => record.id !== id);
    renderFiles();
  });

  const renderOutputs = (result: OperationResult): void => {
    clearUrls();
    const info = result.info ? `<pre class="info-result">${escapeHtml(JSON.stringify(result.info, null, 2))}</pre>` : '';
    const downloads = result.outputs.map((output) => {
      const blob = new Blob([output.buffer], { type: output.type });
      const url = URL.createObjectURL(blob);
      objectUrls.push(url);
      return `<a class="download" href="${url}" download="${escapeHtml(output.name)}">Download ${escapeHtml(output.name)} <span>${humanBytes(blob.size)}</span></a>`;
    }).join('');
    resultArea.innerHTML = `${info}${downloads}`;
  };

  const runPreview = async (): Promise<void> => {
    const file = records[0]?.file;
    if (!file) throw new Error('Choose a PDF first.');
    await previewController?.destroy();
    previewArea.innerHTML = `<div class="viewer-toolbar"><button type="button" data-page="prev">Previous</button><span id="viewer-status">Opening PDF…</span><button type="button" data-page="next">Next</button></div><div class="canvas-shell"><canvas id="pdf-canvas"></canvas></div>`;
    const canvas = previewArea.querySelector<HTMLCanvasElement>('#pdf-canvas');
    const viewerStatus = previewArea.querySelector<HTMLElement>('#viewer-status');
    if (!canvas || !viewerStatus) return;
    previewController = await createPreview(await file.arrayBuffer(), canvas, viewerStatus);
    let current = 1;
    await previewController.render(current);
    previewArea.querySelector('.viewer-toolbar')?.addEventListener('click', (event) => {
      const direction = (event.target as HTMLElement).closest<HTMLElement>('[data-page]')?.dataset.page;
      if (!direction || !previewController) return;
      current = Math.max(1, Math.min(previewController.pageCount, current + (direction === 'next' ? 1 : -1)));
      void previewController.render(current);
    });
  };

  const execute = async (): Promise<void> => {
    if (!records.length) { setError(`Choose ${tool.multipleFiles ? 'files' : 'a file'} first.`); return; }
    setError();
    clearUrls();
    resultArea.replaceChildren();
    mainCancelled = false;
    run.disabled = true;
    cancel.disabled = false;
    setProgress('Preparing document', 4);
    try {
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
        setProgress('Complete', 100);
        return;
      }
      const operation = (tool.id === 'forms' ? 'forms-fill' : tool.id === 'compress' ? 'optimize' : tool.id) as WorkerOperation;
      const workerFiles = await readInputs(records);
      running = runWorkerOperation(operation, workerFiles, formOptions(optionsForm), (update) => setProgress(update.message, Math.min(96, update.percent)));
      const result = await running.result;
      renderOutputs(result);
      setProgress('Complete', 100);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') { setProgress('Cancelled', 0); setError('Operation cancelled.'); }
      else if (error instanceof Error) { setError(`${error.name !== 'Error' ? `${error.name}: ` : ''}${error.message}`); setProgress('Failed', 0); }
      else { setError('The operation failed.'); setProgress('Failed', 0); }
    } finally {
      running = null;
      run.disabled = false;
      cancel.disabled = true;
    }
  };

  cancel.addEventListener('click', () => { mainCancelled = true; running?.cancel(); });
  run.addEventListener('click', () => { void execute(); });

  container.querySelector('[data-inspect-form]')?.addEventListener('click', () => {
    if (!records.length) { setError('Choose a PDF form first.'); return; }
    setError();
    void (async () => {
      try {
        const workerFiles = await readInputs(records);
        const inspect = runWorkerOperation('forms-inspect', workerFiles, {}, (update) => setProgress(update.message, update.percent));
        running = inspect;
        const result = await inspect.result;
        const summary = container.querySelector<HTMLElement>('#form-field-summary');
        const textarea = optionsForm.querySelector<HTMLTextAreaElement>('textarea[name=values]');
        if (summary && result.info) {
          const fieldsText = typeof result.info.fields === 'string' ? result.info.fields : '[]';
          const fields = JSON.parse(fieldsText) as Array<{name:string;type:string;value:string}>;
          summary.innerHTML = `<strong>${fields.length} supported field(s)</strong><ul>${fields.map((field) => `<li>${escapeHtml(field.name)} — ${escapeHtml(field.type)}</li>`).join('')}</ul>`;
          if (textarea) {
            const initial: Record<string, string | boolean> = {};
            fields.forEach((field) => { initial[field.name] = field.type === 'checkbox' ? field.value === 'true' : field.value; });
            textarea.value = JSON.stringify(initial, null, 2);
          }
        }
        setProgress('Form inspection complete', 100);
      } catch (error) {
        setError(error instanceof Error ? `${error.name !== 'Error' ? `${error.name}: ` : ''}${error.message}` : 'Form inspection failed.');
        setProgress('Failed', 0);
      } finally { running = null; }
    })();
  });

  container.addEventListener('docflow-cleanup', () => {
    mainCancelled = true;
    running?.cancel();
    clearUrls();
    void previewController?.destroy();
    previewController = null;
    window.removeEventListener('beforeunload', beforeUnload);
  }, { once: true });
}
