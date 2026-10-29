import {extractEmbeddedImages} from '../pdf/embeddedImages';
import {addShareButton} from '../app/fileExport';
import {workspaceRuntime} from '../app/workspaceRuntime';
import type {ToolDefinition} from './registry';

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

export function mountWorkspace(container: HTMLDivElement, tool: ToolDefinition): void {
  const runtime = workspaceRuntime(container);
  container.innerHTML = `
    <div class="workspace-grid">
      <aside class="workspace-side">
        <p class="eyebrow">CONVERT</p>
        <h2>${escapeHtml(tool.name)}</h2>
        <p>${escapeHtml(tool.description)}</p>
        <div class="quality-box"><strong>Decoded extraction</strong><span>Whole pages are not rendered. Supported embedded raster image objects are decoded by PDF.js and exported as PNG.</span></div>
        <div class="privacy-box"><strong>Local processing</strong><span>No remote PDF-processing API is used. The source PDF remains on this device.</span></div>
      </aside>
      <section class="workspace-main">
        <div class="drop-zone" tabindex="0" role="button" aria-label="Choose files or drop files here">
          <strong>Drop a PDF here</strong><span>or choose from your device</span>
          <input id="workspace-file" type="file" aria-label="Source files" accept=".pdf,application/pdf">
        </div>
        <div id="memory-warning" class="memory-warning" hidden></div>
        <div id="file-list" class="file-list" aria-live="polite"></div>
        <div class="notice"><strong>Technical scope</strong><p>Exports decoded raster images as PNG. Vector artwork, image masks, and page screenshots are not mislabeled as extracted images. Original compressed image-stream bytes are not preserved.</p></div>
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
  const run = container.querySelector<HTMLButtonElement>('#run-operation');
  const cancel = container.querySelector<HTMLButtonElement>('#cancel-operation');
  const stage = container.querySelector<HTMLSpanElement>('#stage');
  const percent = container.querySelector<HTMLSpanElement>('#percent');
  const progress = container.querySelector<HTMLProgressElement>('#progress');
  const error = container.querySelector<HTMLDivElement>('#error');
  const result = container.querySelector<HTMLDivElement>('#result');
  if (!input || !drop || !list || !warning || !run || !cancel || !stage || !percent || !progress || !error || !result) return;

  let file: File | null = null;
  let cancelled = false;
  let running = false;
  let objectUrl: string | null = null;

  const setProgress = (message: string, value: number): void => {
    stage.textContent = message;
    progress.value = value;
    percent.textContent = `${Math.round(value)}%`;
  };
  const setError = (message = ''): void => {
    error.hidden = !message;
    error.textContent = message;
  };
  const clearResult = (): void => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    result.replaceChildren();
  };
  const renderFile = (): void => {
    runtime.inputs(file ? [file] : []);
    list.innerHTML = file ? `<div class="file-row"><span><strong>${escapeHtml(file.name)}</strong><small>${humanBytes(file.size)}</small></span><button type="button" data-remove aria-label="Remove ${escapeHtml(file.name)}">Remove</button></div>` : '';
    warning.hidden = !file || file.size <= 250 * 1024 * 1024;
    if (!warning.hidden && file) warning.textContent = `Large input (${humanBytes(file.size)}). PDF.js avoids whole-page rasterization here, but decoded image objects and the ZIP still consume browser memory.`;
  };
  const choose = (candidate: File | null): void => {
    if (!candidate) return;
    if (!(candidate.type === 'application/pdf' || candidate.name.toLowerCase().endsWith('.pdf'))) {
      setError('Choose a PDF file for embedded-image extraction.');
      return;
    }
    file = candidate;
    setError();
    clearResult();
    setProgress('Ready', 0);
    renderFile();
  };

  input.addEventListener('change', () => { choose(input.files?.[0] ?? null); input.value = ''; });
  drop.addEventListener('click', (event) => { if ((event.target as HTMLElement) !== input) input.click(); });
  drop.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); } });
  for (const eventName of ['dragenter','dragover']) drop.addEventListener(eventName, (event) => { event.preventDefault(); drop.classList.add('dragging'); });
  for (const eventName of ['dragleave','drop']) drop.addEventListener(eventName, (event) => { event.preventDefault(); drop.classList.remove('dragging'); });
  drop.addEventListener('drop', (event) => choose(event.dataTransfer?.files?.[0] ?? null));
  list.addEventListener('click', (event) => {
    if (!(event.target as HTMLElement).closest('[data-remove]')) return;
    file = null;
    clearResult();
    setProgress('Ready', 0);
    renderFile();
  });

  run.addEventListener('click', () => {
    if (!file || running) { if (!file) setError('Choose a PDF first.'); return; }
    cancelled = false;
    running = true;
    runtime.busy(true);
    run.disabled = true;
    cancel.disabled = false;
    setError();
    clearResult();
    setProgress('Opening PDF', 2);
    void file.arrayBuffer()
      .then((buffer) => extractEmbeddedImages(buffer, setProgress, () => cancelled))
      .then(({ blob, count, skipped }) => {
        if (cancelled) throw new DOMException('Operation cancelled', 'AbortError');
        objectUrl = URL.createObjectURL(blob);
        result.innerHTML = `<div class="notice"><strong>${count} embedded raster image${count === 1 ? '' : 's'} extracted</strong><p>The ZIP includes PNG files plus a manifest describing source pages and dimensions.</p>${skipped.length?`<p role="status">Incomplete extraction: ${skipped.length} raster operations were skipped. Check the manifest for pages and reasons.</p>`:''}</div><a class="download" href="${objectUrl}" download="embedded-images.zip">Download embedded-images.zip <span>${humanBytes(blob.size)}</span></a>`;
        addShareButton(result.querySelector<HTMLAnchorElement>('a[download]')!, blob);
        setProgress(skipped.length?'Complete with omissions':'Complete', 100);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') {
          setProgress('Cancelled', 0);
          return;
        }
        const message = reason instanceof Error ? reason.message : 'Embedded-image extraction failed.';
        setError(message);
        setProgress('Failed', 0);
      })
      .finally(() => {
        runtime.busy(false);
        running = false;
        run.disabled = false;
        cancel.disabled = true;
      });
  });

  cancel.addEventListener('click', () => { cancelled = true; cancel.disabled = true; });

  const beforeUnload = (event: BeforeUnloadEvent): void => {
    if (!file && !running) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', beforeUnload);

  container.addEventListener('docflow-cleanup', () => {
    cancelled = true;
    clearResult();
    window.removeEventListener('beforeunload', beforeUnload);
    file = null;
  }, { once: true });
}
