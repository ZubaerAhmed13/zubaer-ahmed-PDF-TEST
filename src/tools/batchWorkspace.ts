import '../styles/batch.css';
import type { ToolDefinition } from './registry';
import { runWorkerOperation, type RunningOperation } from '../pdf/workerClient';
import type { InputFile, OperationResult, OutputFile, WorkerOperation } from '../pdf/types';

type BatchOperation = 'rotate' | 'page-numbers' | 'watermark' | 'optimize';
type QueueState = 'pending' | 'running' | 'complete' | 'failed' | 'cancelled';

interface QueueItem {
  id: string;
  file: File;
  state: QueueState;
  status: string;
  output?: OutputFile;
}

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

function safeBaseName(name: string): string {
  const withoutExtension = name.replace(/\.pdf$/i, '');
  const cleaned = withoutExtension.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'document';
}

function optionsMarkup(operation: BatchOperation): string {
  if (operation === 'rotate') return `
    <label>Apply to<select name="target"><option value="all">All pages</option><option value="odd">Odd pages</option><option value="even">Even pages</option><option value="selected">Selected pages</option></select></label>
    <label>Selected pages<input name="pages" placeholder="1,3,5-8"></label>
    <label>Rotation<select name="degrees"><option value="90">90° clockwise</option><option value="180">180°</option><option value="270">270° clockwise</option></select></label>`;
  if (operation === 'page-numbers') return `
    <label>Pages<input name="pages" placeholder="Blank = all pages"></label>
    <label>Starting number<input name="start" type="number" value="1"></label>
    <label>Format<select name="format"><option value="page-total">Page 1 of 20</option><option value="fraction">1 / 20</option><option value="page">Page 1</option><option value="number">1</option></select></label>
    <label>Font size<input name="fontSize" type="number" min="6" max="72" value="11"></label>
    <label>Bottom margin (pt)<input name="margin" type="number" min="4" value="24"></label>`;
  if (operation === 'watermark') return `
    <label class="wide">Watermark text<input name="text" value="CONFIDENTIAL"></label>
    <label>Opacity<input name="opacity" type="number" min=".05" max="1" step=".05" value=".18"></label>
    <label>Rotation<input name="rotation" type="number" min="-180" max="180" value="-35"></label>
    <label>Font size<input name="fontSize" type="number" min="12" max="120" value="42"></label>`;
  return `<div class="notice wide"><strong>Structural optimization only</strong><p>This batch mode re-saves PDF structure with object streams. It does not claim professional image recompression.</p></div>`;
}

function collectOptions(form: HTMLFormElement): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  const data = new FormData(form);
  for (const [key, value] of data.entries()) options[key] = value;
  form.querySelectorAll<HTMLInputElement>('input[type=number]').forEach((input) => {
    if (input.name && input.value !== '') options[input.name] = Number(input.value);
  });
  return options;
}

function workerOperation(operation: BatchOperation): WorkerOperation {
  return operation;
}

function outputName(fileName: string, operation: BatchOperation): string {
  const suffix = operation === 'page-numbers' ? 'numbered' : operation === 'watermark' ? 'watermarked' : operation === 'optimize' ? 'optimized' : 'rotated';
  return `${safeBaseName(fileName)}-${suffix}.pdf`;
}

async function inputFile(file: File): Promise<InputFile> {
  return { name: file.name, type: file.type, buffer: await file.arrayBuffer() };
}

export function mountWorkspace(container: HTMLDivElement, tool: ToolDefinition): void {
  container.innerHTML = `
    <div class="batch-workspace">
      <aside class="batch-side">
        <p class="eyebrow">BATCH · LOCAL · BOUNDED</p>
        <h2>${escapeHtml(tool.name)}</h2>
        <p>Queue multiple PDFs and process them sequentially. Only one PDF worker runs at a time so batch size does not multiply active processing memory.</p>
        <div class="privacy-box"><strong>Local processing</strong><span>PDF bytes are read only when each queue item runs and are transferred to the dedicated worker. No remote processing API is configured.</span></div>
        <div class="quality-box"><strong>Structural operations only</strong><span>The first certified batch set uses already-migrated rotate, page-number, text-watermark and structural-optimize engines.</span></div>
      </aside>
      <section class="batch-main">
        <div class="batch-drop" tabindex="0" role="button" aria-label="Choose PDF files or drop them here">
          <strong>Drop PDF files here</strong><span>or choose multiple files from your device</span>
          <input id="batch-files" type="file" accept=".pdf,application/pdf" multiple>
        </div>
        <div id="batch-memory-warning" class="memory-warning" hidden></div>
        <form id="batch-form" class="batch-controls">
          <label class="wide">Operation<select name="operation" aria-label="Batch operation">
            <option value="rotate">Rotate pages</option>
            <option value="page-numbers">Add page numbers</option>
            <option value="watermark">Add text watermark</option>
            <option value="optimize">Structural optimize</option>
          </select></label>
          <div class="wide batch-operation-options"></div>
        </form>
        <div class="operation-status" aria-live="polite">
          <div class="status-line"><span id="batch-stage">Ready</span><span id="batch-percent">0%</span></div>
          <progress id="batch-progress" max="100" value="0"></progress>
          <div id="batch-error" class="error-box" role="alert" hidden></div>
        </div>
        <div class="batch-actions">
          <button class="secondary" id="batch-cancel" type="button" disabled>Cancel batch</button>
          <button class="primary" id="batch-run" type="button">Run batch</button>
          <button class="secondary" id="batch-zip" type="button" disabled>Prepare ZIP</button>
        </div>
        <div id="batch-queue" class="batch-queue" aria-live="polite"></div>
        <div id="batch-results" class="batch-results"></div>
      </section>
    </div>`;

  const input = container.querySelector<HTMLInputElement>('#batch-files');
  const drop = container.querySelector<HTMLElement>('.batch-drop');
  const warning = container.querySelector<HTMLElement>('#batch-memory-warning');
  const form = container.querySelector<HTMLFormElement>('#batch-form');
  const operationSelect = form?.querySelector<HTMLSelectElement>('select[name="operation"]') ?? null;
  const operationOptions = form?.querySelector<HTMLElement>('.batch-operation-options') ?? null;
  const stage = container.querySelector<HTMLElement>('#batch-stage');
  const percent = container.querySelector<HTMLElement>('#batch-percent');
  const progress = container.querySelector<HTMLProgressElement>('#batch-progress');
  const errorBox = container.querySelector<HTMLElement>('#batch-error');
  const queue = container.querySelector<HTMLElement>('#batch-queue');
  const results = container.querySelector<HTMLElement>('#batch-results');
  const runButton = container.querySelector<HTMLButtonElement>('#batch-run');
  const cancelButton = container.querySelector<HTMLButtonElement>('#batch-cancel');
  const zipButton = container.querySelector<HTMLButtonElement>('#batch-zip');
  if (!input || !drop || !warning || !form || !operationSelect || !operationOptions || !stage || !percent || !progress || !errorBox || !queue || !results || !runButton || !cancelButton || !zipButton) return;

  let items: QueueItem[] = [];
  let running: RunningOperation | null = null;
  let cancelled = false;
  let locked = false;
  let disposed = false;
  let urls: string[] = [];

  const clearUrls = (): void => {
    urls.forEach((url) => URL.revokeObjectURL(url));
    urls = [];
  };

  const setError = (message = ''): void => {
    errorBox.hidden = !message;
    errorBox.textContent = message;
  };

  const setProgress = (message: string, value: number): void => {
    stage.textContent = message;
    progress.value = value;
    percent.textContent = `${Math.round(value)}%`;
  };

  const updateWarning = (): void => {
    const total = items.reduce((sum, item) => sum + item.file.size, 0);
    warning.hidden = total <= 250 * 1024 * 1024;
    if (!warning.hidden) warning.textContent = `Large batch selection (${humanBytes(total)}). Processing is sequential to bound active worker memory, but each current PDF is still buffered by pdf-lib while its operation runs.`;
  };

  const renderQueue = (): void => {
    queue.innerHTML = items.map((item, index) => `
      <div class="batch-row" data-batch-id="${item.id}" data-state="${item.state}">
        <span><strong>${escapeHtml(item.file.name)}</strong><small>${humanBytes(item.file.size)} · Queue #${index + 1}</small><span class="batch-state">${escapeHtml(item.status)}</span></span>
        <button type="button" class="secondary" data-remove-batch="${item.id}" ${locked ? 'disabled' : ''}>Remove</button>
      </div>`).join('') || '<p class="quick-empty">Add PDF files to build the queue.</p>';
    updateWarning();
  };

  const renderResults = (): void => {
    clearUrls();
    const completed = items.filter((item) => item.state === 'complete' && item.output);
    results.innerHTML = completed.map((item) => {
      const output = item.output!;
      const blob = new Blob([output.buffer], { type: output.type });
      const url = URL.createObjectURL(blob);
      urls.push(url);
      return `<a class="download" href="${url}" download="${escapeHtml(output.name)}">Download ${escapeHtml(output.name)} <span>${humanBytes(blob.size)}</span></a>`;
    }).join('');
    zipButton.disabled = locked || completed.length === 0;
  };

  const resetOperationOptions = (): void => {
    operationOptions.innerHTML = optionsMarkup(operationSelect.value as BatchOperation);
  };

  const addFiles = (files: FileList | File[]): void => {
    if (locked) return;
    const candidates = [...files];
    const valid = candidates.filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
    if (valid.length !== candidates.length) setError('One or more files were rejected because batch processing currently accepts PDF files only.');
    else setError();
    const existing = new Set(items.map((item) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`));
    for (const file of valid) {
      const fingerprint = `${file.name}:${file.size}:${file.lastModified}`;
      if (existing.has(fingerprint)) continue;
      existing.add(fingerprint);
      items.push({ id: crypto.randomUUID(), file, state: 'pending', status: 'Pending' });
    }
    renderQueue();
  };

  const lockUi = (value: boolean): void => {
    locked = value;
    input.disabled = value;
    operationSelect.disabled = value;
    form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select').forEach((control) => { control.disabled = value; });
    runButton.disabled = value;
    cancelButton.disabled = !value;
    if (value) zipButton.disabled = true;
    renderQueue();
  };

  const execute = async (): Promise<void> => {
    if (locked) return;
    if (!items.length) { setError('Choose at least one PDF for the batch queue.'); return; }
    setError();
    clearUrls();
    results.replaceChildren();
    cancelled = false;
    const operation = operationSelect.value as BatchOperation;
    const options = collectOptions(form);
    delete options.operation;
    items = items.map((item) => ({ id: item.id, file: item.file, state: 'pending', status: 'Pending' }));
    lockUi(true);

    let succeeded = 0;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]!;
      if (cancelled || disposed) {
        item.state = 'cancelled';
        item.status = 'Cancelled';
        continue;
      }
      item.state = 'running';
      item.status = 'Preparing';
      renderQueue();
      const baseProgress = (index / items.length) * 100;
      const perItem = 100 / items.length;
      setProgress(`Processing ${index + 1} of ${items.length}: ${item.file.name}`, baseProgress);
      try {
        const file = await inputFile(item.file);
        if (cancelled || disposed) throw new DOMException('Operation cancelled', 'AbortError');
        running = runWorkerOperation(workerOperation(operation), [file], options, (update) => {
          item.status = update.message;
          const overall = baseProgress + (Math.min(96, update.percent) / 100) * perItem;
          setProgress(`File ${index + 1} of ${items.length}: ${update.message}`, overall);
          const stateNode = queue.querySelector<HTMLElement>(`[data-batch-id="${item.id}"] .batch-state`);
          if (stateNode) stateNode.textContent = item.status;
        });
        const operationResult: OperationResult = await running.result;
        const output = operationResult.outputs[0];
        if (!output) throw new Error('This batch operation did not return a PDF output.');
        item.output = { ...output, name: outputName(item.file.name, operation) };
        item.state = 'complete';
        item.status = 'Complete';
        succeeded += 1;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          cancelled = true;
          item.state = 'cancelled';
          item.status = 'Cancelled';
        } else {
          item.state = 'failed';
          item.status = error instanceof Error ? `${error.name !== 'Error' ? `${error.name}: ` : ''}${error.message}` : 'Failed';
        }
      } finally {
        running = null;
        renderQueue();
      }
    }

    if (!disposed) {
      items.forEach((item) => {
        if (cancelled && item.state === 'pending') { item.state = 'cancelled'; item.status = 'Cancelled'; }
      });
      renderQueue();
      renderResults();
      setProgress(cancelled ? `Batch cancelled · ${succeeded} completed` : `Batch complete · ${succeeded} of ${items.length} succeeded`, cancelled ? Math.min(99, (succeeded / items.length) * 100) : 100);
      lockUi(false);
      zipButton.disabled = items.every((item) => item.state !== 'complete' || !item.output);
    }
  };

  const prepareZip = async (): Promise<void> => {
    const completed = items.filter((item) => item.state === 'complete' && item.output);
    if (!completed.length) return;
    zipButton.disabled = true;
    setProgress('Preparing ZIP from completed outputs', 98);
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      completed.forEach((item) => zip.file(item.output!.name, item.output!.buffer));
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const link = document.createElement('a');
      link.className = 'download';
      link.href = url;
      link.download = 'docflow-batch-results.zip';
      link.textContent = `Download docflow-batch-results.zip (${humanBytes(blob.size)})`;
      results.prepend(link);
      setProgress(`ZIP ready · ${completed.length} output${completed.length === 1 ? '' : 's'}`, 100);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not prepare the ZIP archive.');
    } finally {
      zipButton.disabled = false;
    }
  };

  input.addEventListener('change', () => { if (input.files) addFiles(input.files); input.value = ''; });
  drop.addEventListener('click', (event) => { if ((event.target as HTMLElement) !== input) input.click(); });
  drop.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); } });
  for (const eventName of ['dragenter','dragover']) drop.addEventListener(eventName, (event) => { event.preventDefault(); drop.classList.add('dragging'); });
  for (const eventName of ['dragleave','drop']) drop.addEventListener(eventName, (event) => { event.preventDefault(); drop.classList.remove('dragging'); });
  drop.addEventListener('drop', (event) => { if (event.dataTransfer?.files) addFiles(event.dataTransfer.files); });
  queue.addEventListener('click', (event) => {
    if (locked) return;
    const id = (event.target as HTMLElement).closest<HTMLElement>('[data-remove-batch]')?.dataset.removeBatch;
    if (!id) return;
    items = items.filter((item) => item.id !== id);
    renderQueue();
  });
  operationSelect.addEventListener('change', resetOperationOptions);
  runButton.addEventListener('click', () => { void execute(); });
  cancelButton.addEventListener('click', () => { cancelled = true; running?.cancel(); });
  zipButton.addEventListener('click', () => { void prepareZip(); });

  const beforeUnload = (event: BeforeUnloadEvent): void => {
    if (!locked) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', beforeUnload);

  resetOperationOptions();
  renderQueue();

  container.addEventListener('docflow-cleanup', () => {
    disposed = true;
    cancelled = true;
    running?.cancel();
    running = null;
    clearUrls();
    window.removeEventListener('beforeunload', beforeUnload);
  }, { once: true });
}
