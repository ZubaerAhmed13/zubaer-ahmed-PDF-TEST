import { addShareButton, addOutputSharing } from '../app/fileExport';
import { workspaceRuntime } from '../app/workspaceRuntime';
import '../styles/batch.css';
import type { ToolDefinition } from './registry';
import { runWorkerOperation, type RunningOperation } from '../pdf/workerClient';
import type { InputFile, OperationResult, OutputFile, WorkerOperation } from '../pdf/types';
import { MAX_FILES, MAX_FILE_BYTES, MAX_BATCH_BYTES, validateStep, type WorkflowStep } from '../workflows/workflowEngine';
import type { WorkflowPreflight } from '../workflows/workflowPreflight';

type BatchOperation = 'rotate' | 'page-numbers' | 'watermark' | 'optimize';
type QueueState = 'pending' | 'running' | 'complete' | 'failed' | 'cancelled';

interface QueueItem {
  id: string;
  file: File;
  state: QueueState;
  status: string;
  output?: OutputFile;
  execution?: WorkflowStep;
  summary?: string;
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
  return `<div class="notice wide"><strong>Optimise supported images</strong><p>Recompression can change image pixels. Unsupported images remain unchanged; a smaller file is not guaranteed.</p></div>`;
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
  const runtime = workspaceRuntime(container);
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
          <button class="secondary" id="batch-check" type="button">Check batch</button>
          <button class="secondary" id="batch-retry" type="button" disabled>Retry failed files</button>
          <button class="primary" id="batch-run" type="button">Run batch</button>
          <button class="secondary" id="batch-zip" type="button" disabled>Prepare ZIP</button>
        </div>
        <p class="help">Check batch previews page counts and consequences. Retry uses each file’s original and last executed settings, even if you edit the controls. Run batch starts a new job for every file.</p>
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
  const checkButton = container.querySelector<HTMLButtonElement>('#batch-check')!;
  const retryButton = container.querySelector<HTMLButtonElement>('#batch-retry')!;
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
  const invalidateZip = (): void => {
    for (const group of results.querySelectorAll<HTMLElement>('[data-zip-export]')) {
      const url = group.querySelector<HTMLAnchorElement>('a')?.href;
      if (url) { URL.revokeObjectURL(url); urls = urls.filter(value => value !== url); }
      group.remove();
    }
  };
  results.addEventListener('docflow-output-renamed', invalidateZip);

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
    runtime.inputs(items.map(item => item.file));
    queue.innerHTML = items.map((item, index) => `
      <div class="batch-row" data-batch-id="${item.id}" data-state="${item.state}">
        <span><strong>${escapeHtml(item.file.name)}</strong><small>${humanBytes(item.file.size)} · Queue #${index + 1}</small><span class="batch-state">${escapeHtml(item.status)}</span></span>
        <button type="button" class="secondary" data-remove-batch="${item.id}" ${locked ? 'disabled' : ''}>Remove</button>
        ${item.execution && (item.state === 'failed' || item.state === 'cancelled') ? `<button type="button" class="secondary" data-retry-batch="${item.id}" aria-label="Retry ${escapeHtml(item.file.name)}" ${locked ? 'disabled' : ''}>Retry this file</button>` : ''}
      </div>`).join('') || '<p class="quick-empty">Add PDF files to build the queue.</p>';
    updateWarning();
    retryButton.disabled = locked || !items.some(item => item.execution && (item.state === 'failed' || item.state === 'cancelled'));
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
    addOutputSharing(results, completed.map(item => item.output!), completed.map(item => item.file));
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
    const existing = new Set(items.map((item) => item.file));
    let total = items.reduce((sum, item) => sum + item.file.size, 0);
    for (const file of valid) {
      if (existing.has(file)) continue;
      if (!file.size || file.size > MAX_FILE_BYTES || items.length >= MAX_FILES || total + file.size > MAX_BATCH_BYTES) { setError('Batch limits: 20 PDFs, 50 MB each, 150 MB combined.'); continue; }
      existing.add(file); total += file.size;
      items.push({ id: crypto.randomUUID(), file, state: 'pending', status: 'Pending' });
    }
    renderQueue();
  };

  const lockUi = (value: boolean): void => {
    runtime.busy(value);
    locked = value;
    input.disabled = value;
    operationSelect.disabled = value;
    form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select').forEach((control) => { control.disabled = value; });
    results.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button').forEach(control => { control.disabled = value; });
    runButton.disabled = value;
    checkButton.disabled = value;
    cancelButton.disabled = !value;
    if (value) zipButton.disabled = true;
    renderQueue();
  };

  const currentStep = (): WorkflowStep => {
    const options = collectOptions(form); delete options.operation;
    if (options.degrees !== undefined) options.degrees = Number(options.degrees);
    return validateStep({ id: 'batch-step', operation: operationSelect.value, options });
  };
  const preflight = async (item: QueueItem, step: WorkflowStep): Promise<void> => {
    const file = await inputFile(item.file);
    if (cancelled || disposed) throw new DOMException('Cancelled', 'AbortError');
    running = runWorkerOperation('workflow-preflight', [file], { steps: [step] }, () => {});
    const result = await running.result; running = null;
    if (cancelled || disposed) throw new DOMException('Cancelled', 'AbortError');
    const report = JSON.parse(String(result.info?.preflight)) as WorkflowPreflight;
    item.summary = report.inputPages + ' → ' + report.outputPages + ' pages. ' + report.steps.flatMap(step => step.warnings).join(' ');
  };
  const execute = async (retryOnly = false, selectedId?: string): Promise<void> => {
    if (locked) return;
    if (!items.length) { setError('Choose at least one PDF for the batch queue.'); return; }
    setError();
    if (!retryOnly) { clearUrls(); results.replaceChildren(); }
    cancelled = false;
    let step: WorkflowStep;
    try { step = retryOnly ? { id: 'unused', operation: 'rotate', options: {} } : currentStep(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Invalid batch options.'); return; }
    const targets = retryOnly ? items.filter(item => (!selectedId || item.id === selectedId) && item.execution && (item.state === 'failed' || item.state === 'cancelled')) : items;
    for (const item of targets) { item.state = 'pending'; item.status = 'Pending'; item.output = undefined; if (!retryOnly) item.execution = step; }
    lockUi(true);

    let succeeded = 0;
    const outputNames = new Set(items.filter(item => item.output).map(item => item.output!.name.toLowerCase()));
    for (let index = 0; index < targets.length; index += 1) {
      const item = targets[index]!;
      const operation = item.execution!.operation as BatchOperation;
      const options = item.execution!.options;
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
        await preflight(item, item.execution!);
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
        if (cancelled || disposed) throw new DOMException('Cancelled', 'AbortError');
        const output = operationResult.outputs[0];
        if (!output) throw new Error('This batch operation did not return a PDF output.');
        const base = outputName(item.file.name, operation);
        let name = base, suffix = 2;
        while (outputNames.has(name.toLowerCase())) name = base.replace(/\.pdf$/i, '') + '-' + suffix++ + '.pdf';
        outputNames.add(name.toLowerCase());
        if (items.reduce((size, other) => size + (other.output?.buffer.byteLength ?? 0), 0) + output.buffer.byteLength > MAX_BATCH_BYTES) throw Error('Completed outputs exceed the 150 MB batch budget. Export a smaller batch.');
        item.output = { ...output, name };
        item.state = 'complete';
        item.status = 'Complete · ' + (item.summary ?? 'Review the result');
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
        if (!disposed) renderQueue();
      }
    }

    if (!disposed) {
      items.forEach((item) => {
        if (cancelled && item.state === 'pending') { item.state = 'cancelled'; item.status = 'Cancelled'; }
      });
      renderQueue();
      renderResults();
      if (!cancelled) runtime.result({ outputs: items.filter(item => item.state === 'complete' && item.output).map(item => item.output!) });
      setProgress(cancelled ? `Batch cancelled · ${succeeded} completed` : `Batch complete · ${succeeded} of ${items.length} succeeded`, cancelled ? Math.min(99, (succeeded / items.length) * 100) : 100);
      lockUi(false);
      zipButton.disabled = items.every((item) => item.state !== 'complete' || !item.output);
    }
  };

  const prepareZip = async (): Promise<void> => {
    if (locked) return;
    const completed = items.filter((item) => item.state === 'complete' && item.output);
    if (!completed.length) return;
    cancelled = false; lockUi(true); invalidateZip();
    setProgress('Preparing ZIP from completed outputs', 98);
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      completed.forEach((item) => zip.file(item.output!.name, item.output!.buffer));
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      if (disposed || cancelled) return;
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const link = document.createElement('a');
      link.className = 'download';
      link.href = url;
      link.download = 'docflow-batch-results.zip';
      link.textContent = `Download docflow-batch-results.zip (${humanBytes(blob.size)})`;
      const group = document.createElement('div'); group.dataset.zipExport = 'true'; group.className = 'export-archive'; group.append(link); results.prepend(group);
      addShareButton(link, blob);
      setProgress(`ZIP ready · ${completed.length} output${completed.length === 1 ? '' : 's'}`, 100);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not prepare the ZIP archive.');
    } finally {
      if (!disposed) { lockUi(false); zipButton.disabled = false; }
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
    const retry = (event.target as HTMLElement).closest<HTMLElement>('[data-retry-batch]')?.dataset.retryBatch;
    if (retry) { void execute(true, retry); return; }
    const id = (event.target as HTMLElement).closest<HTMLElement>('[data-remove-batch]')?.dataset.removeBatch;
    if (!id) return;
    items = items.filter((item) => item.id !== id);
    renderQueue();
    renderResults();
  });
  operationSelect.addEventListener('change', resetOperationOptions);
  runButton.addEventListener('click', () => { void execute(); });
  retryButton.addEventListener('click', () => { void execute(true); });
  checkButton.addEventListener('click', () => {
    if (locked || !items.length) { setError('Choose PDF files first.'); return; }
    let step: WorkflowStep;
    try { step = currentStep(); } catch (error) { setError(String(error)); return; }
    cancelled = false; setError(); lockUi(true);
    void (async () => {
      for (const item of items) {
        if (cancelled || disposed) break;
        try { await preflight(item, step); item.status = 'Checked · ' + item.summary; }
        catch (error) { if (cancelled || disposed) break; item.status = 'Check failed: ' + (error instanceof Error ? error.message : 'Invalid file'); }
        finally { running = null; if (!disposed) renderQueue(); }
      }
      if (!disposed) { lockUi(false); zipButton.disabled = !items.some(item => item.output); setProgress(cancelled ? 'Batch check cancelled' : 'Batch check complete · documents unchanged', cancelled ? 0 : 100); }
    })();
  });
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
