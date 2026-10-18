import { openLocalPdf } from '../pdf/pdfjsPolicy';
import { abortable } from '../pdf/pdfCancellation';
import { addShareButton } from '../app/fileExport';
import { workspaceRuntime } from '../app/workspaceRuntime';
import '../styles/professional-tools.css';
import type { ToolDefinition } from './registry';
import { rectangleFromDrag, validateRedactions, redactPdf, renderPageImage, loadRedactionDocument, type RedactionRect, REDACTION_MAX_BYTES, chooseRasterScale } from '../pdf/secureRasterRedaction';
import { runQpdfOperation, type RunningQpdfOperation } from '../pdf/qpdfWorkerClient';
import type { OperationResult } from '../pdf/types';
import type { PDFDocumentProxy } from 'pdfjs-dist';

function cleanName(value: string): string {
  return value.replace(/[^a-z0-9_.-]+/gi,'-').slice(0,95) || 'document';
}
export function mountWorkspace(container: HTMLDivElement, tool: ToolDefinition): void {
  const runtime = workspaceRuntime(container);
  const redact = tool.id === 'redact-secure';
  container.innerHTML = '<div class="pro-tool"><header class="pro-head"><p class="eyebrow">PROFESSIONAL · LOCAL</p><h2></h2><p>' +
    (redact ? 'Permanently remove selected visible regions by rebuilding all pages into a new image-only PDF.' : 'Attempt to recover damaged cross-reference tables and normalise PDF structure with local qpdf.') + '</p></header>' +
    '<div class="pro-callout" role="note"><strong>' + (redact ? 'Redaction removes document structure' : 'Recovery is not guaranteed') + '</strong><p>' +
    (redact ? 'Every page is rasterised. All original text layers, embedded files, forms, bookmarks, scripts, signatures, accessibility tags and metadata are discarded—even on pages without redaction marks. Never use Crop or Annotate for confidential removal. Review the downloaded PDF visually.' :
      'This repairs some damaged page/object references but cannot recreate missing bytes, recover encrypted files without passwords, reconstruct corrupted images or guarantee validity. Warnings remain visible.') +
    '</p></div>' +
    '<div class="pro-body"><label class="pro-file-label" for="pro-pdf">Choose a PDF (processed only in your browser)</label>' +
    '<input id="pro-pdf" type="file" accept=".pdf,application/pdf" aria-label="Source PDF">' +
    (redact ? '<div class="pro-preview-toolbar"><button type="button" id="pro-prev" class="secondary" disabled>Previous page</button><span id="pro-page-status" role="status">Choose a PDF</span><button type="button" id="pro-next" class="secondary" disabled>Next page</button></div>' +
      '<div class="pro-canvas-wrap"><canvas id="pro-canvas" aria-label="PDF page preview"></canvas><canvas id="pro-overlay" aria-label="Draw redaction regions on the current page" tabindex="0"></canvas></div>' +
      '<p class="pro-help">Drag over sensitive content to select an area. Use the percentage fields below as a keyboard alternative. Red masks show what will be removed from the exported copy.</p>' +
      '<form id="pro-coordinates"><label>X from left (%)<input name="x" type="number" min="0" max="99" step=".1" value="10" required></label>' +
      '<label>Y from top (%)<input name="y" type="number" min="0" max="99" step=".1" value="10" required></label>' +
      '<label>Width (%)<input name="width" type="number" min=".5" max="100" step=".1" value="40" required></label>' +
      '<label>Height (%)<input name="height" type="number" min=".5" max="100" step=".1" value="10" required></label>' +
      '<button type="submit" class="secondary">Add area using coordinates</button></form>' +
      '<div class="pro-mask-actions"><strong id="pro-mark-count" aria-live="polite">0 redaction areas</strong>' +
      '<button type="button" id="pro-undo" class="secondary" disabled>Undo last area</button><button type="button" id="pro-clear" class="secondary" disabled>Clear all areas</button></div>' +
      '<div id="pro-region-list" aria-label="Redaction area review"></div>' +
      '<label>Export resolution<select id="pro-dpi"><option value="72">72 DPI · smaller</option><option value="115.2" selected>115 DPI · balanced</option><option value="150">150 DPI</option><option value="300">300 DPI · capped for large pages</option></select></label>' +
      '<p id="pro-raster-estimate" class="pro-help">Resolution is capped at 2,200 pixels per dimension and 3.2 million pixels per page.</p>' +
      '<button type="button" id="pro-size-preview" class="secondary">Build export size preview</button><p id="pro-size-result" role="status"></p>' +
      '<label class="pro-confirm"><input id="pro-confirm" type="checkbox"> I understand this will permanently rasterise the entire document, remove selectable text and document structure, and I will visually review the export.</label>'
      : '<p class="pro-help">Your original PDF is never overwritten. Recovery rewrites cross-references and compatible streams to a newly downloaded file. It does not intentionally flatten or rasterise the document.</p>') +
    '<div class="pro-progress" role="status" aria-live="polite"><span id="pro-stage">Ready</span><progress id="pro-progress" value="0" max="100"></progress><p id="pro-error" role="alert" hidden></p></div>' +
    '<div class="pro-actions"><button type="button" id="pro-cancel" class="secondary" disabled>Cancel</button>' +
    '<button type="button" id="pro-execute" class="primary">' + (redact ? 'Apply permanent redactions' : 'Attempt structural repair') + '</button></div>' +
    '<div id="pro-results" aria-live="polite"></div></div></div>';

  container.querySelector<HTMLHeadingElement>('.pro-head h2')!.textContent = tool.name;
  const input = container.querySelector<HTMLInputElement>('#pro-pdf')!;
  const run = container.querySelector<HTMLButtonElement>('#pro-execute')!;
  const cancel = container.querySelector<HTMLButtonElement>('#pro-cancel')!;
  const status = container.querySelector<HTMLElement>('#pro-stage')!;
  const progress = container.querySelector<HTMLProgressElement>('#pro-progress')!;
  const error = container.querySelector<HTMLElement>('#pro-error')!;
  const output = container.querySelector<HTMLElement>('#pro-results')!;
  const prev = container.querySelector<HTMLButtonElement>('#pro-prev');
  const next = container.querySelector<HTMLButtonElement>('#pro-next');
  const pageLabel = container.querySelector<HTMLElement>('#pro-page-status');
  const canvas = container.querySelector<HTMLCanvasElement>('#pro-canvas');
  const overlay = container.querySelector<HTMLCanvasElement>('#pro-overlay');
  const markLabel = container.querySelector<HTMLElement>('#pro-mark-count');
  const undo = container.querySelector<HTMLButtonElement>('#pro-undo');
  const clear = container.querySelector<HTMLButtonElement>('#pro-clear');
  const confirm = container.querySelector<HTMLInputElement>('#pro-confirm');
  const dpi = container.querySelector<HTMLSelectElement>('#pro-dpi');
  const sizePreview = container.querySelector<HTMLButtonElement>('#pro-size-preview');
  const sizeResult = container.querySelector<HTMLElement>('#pro-size-result');
  const regionList = container.querySelector<HTMLElement>('#pro-region-list');
  let prepared: OperationResult | null = null;
  const coordForm = container.querySelector<HTMLFormElement>('#pro-coordinates');

  let file: File | null = null;
  let pdf: PDFDocumentProxy | null = null;
  let page = 1;
  let marks: RedactionRect[] = [];
  let generation = 0;
  let active = false;
  let disposed = false;
  let abort: AbortController | null = null;
  let qpdf: RunningQpdfOperation | null = null;
  let url: string | null = null;
  let drag: { x: number; y: number; pointer: number } | null = null;

  const showError = (message = ''): void => { error.hidden = !message; error.textContent = message; };
  const progressText = (message: string, percent: number): void => {
    status.textContent = message; progress.value = Math.min(100, Math.max(0, percent));
  };
  const resetDownload = (invalidate = true): void => {
    if (invalidate) { prepared = null; if (sizeResult) sizeResult.textContent = ''; }
    if (url) { URL.revokeObjectURL(url); url = null; }
    output.replaceChildren();
  };
  const renderResult = (result: OperationResult): void => {
    runtime.result(result);
    resetDownload();
    const entry = result.outputs[0];
    if (!entry || entry.type !== 'application/pdf') throw Error('Output is not a PDF.');
    url = URL.createObjectURL(new Blob([entry.buffer], { type: entry.type }));
    const notice = document.createElement('p');
    notice.className = 'pro-complete';
    notice.textContent = redact
      ? 'New image-only PDF created. No original PDF objects were copied. Review every page before sharing.'
      : 'qpdf structural rewrite completed. This is not a guarantee that every damaged component was restored.';
    output.append(notice);
    const warnings = result.info?.warning;
    if (typeof warnings === 'string' && warnings) {
      const message = document.createElement('p');
      message.className = 'pro-warning';
      message.textContent = 'qpdf reported warnings: ' + warnings;
      output.append(message);
    }
    const link = document.createElement('a');
    link.className = 'download';
    link.href = url;
    link.download = cleanName(file?.name.replace(/\.pdf$/i,'') ?? 'document') + (redact ? '-redacted.pdf' : '-repaired.pdf');
    link.textContent = 'Download ' + link.download;
    output.append(link);
    addShareButton(link, new Blob([entry.buffer], { type: entry.type }));
  };
  const drawOverlay = (draft: RedactionRect | null = null): void => {
    if (!overlay) return;
    const context = overlay.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, overlay.width, overlay.height);
    const chosen = [...marks.filter(r => r.page === page), ...(draft ? [draft] : [])];
    for (const rect of chosen) {
      context.fillStyle = 'rgba(0,0,0,.94)';
      context.strokeStyle = '#ffb64c';
      context.lineWidth = Math.max(1, overlay.width / 420);
      const x = rect.x * overlay.width, y = rect.y * overlay.height;
      const w = rect.width * overlay.width, h = rect.height * overlay.height;
      context.fillRect(x, y, w, h);
      context.strokeRect(x, y, w, h);
    }
    if (regionList) {
      regionList.replaceChildren();
      marks.forEach((mark, index) => {
        const row = document.createElement('div'); row.className = 'pro-region-row';
        const jump = document.createElement('button'); jump.type = 'button'; jump.className = 'secondary'; jump.disabled = active;
        jump.textContent = `Area ${index+1} · page ${mark.page} · X ${(mark.x*100).toFixed(1)}%, Y ${(mark.y*100).toFixed(1)}%, ${(mark.width*100).toFixed(1)}% × ${(mark.height*100).toFixed(1)}%`;
        jump.addEventListener('click', () => { if (!active) { page = mark.page; void renderPreview().catch(e => showError(String(e))); } });
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary'; remove.disabled = active; remove.textContent = 'Remove area '+(index+1);
        remove.addEventListener('click', () => { if (!active) { marks.splice(index,1); resetDownload(); drawOverlay(); } });
        row.append(jump,remove); regionList.append(row);
      });
    }
    if (markLabel) markLabel.textContent = marks.length + ' redaction area(s) · ' + marks.filter(m => m.page === page).length + ' on page ' + page;
    if (undo) undo.disabled = !marks.length || active;
    if (clear) clear.disabled = !marks.length || active;
  };
  const nav = (): void => {
    if (pageLabel) pageLabel.textContent = pdf ? 'Page ' + page + ' of ' + pdf.numPages : 'Choose a PDF';
    if (prev) prev.disabled = active || !pdf || page <= 1;
    if (next) next.disabled = active || !pdf || page >= pdf.numPages;
  };
  const renderPreview = async (): Promise<void> => {
    const epoch = ++generation;
    if (!pdf || !canvas || !overlay) return;
    nav();
    progressText('Rendering preview page ' + page, 3);
    const proxy = await pdf.getPage(page);
    let rendered: HTMLCanvasElement | null = null;
    try {
      const view = proxy.getViewport({ scale: 1 });
      const exportScale = chooseRasterScale(view.width, view.height, Number(dpi?.value ?? 115.2));
      const estimate = container.querySelector<HTMLElement>('#pro-raster-estimate');
      if (estimate) estimate.textContent = `Current page: ${Math.floor(view.width*exportScale)} × ${Math.floor(view.height*exportScale)} pixels, ${Math.round(exportScale*72)} effective DPI; about ${(view.width*view.height*exportScale*exportScale*4/1048576).toFixed(1)} MB per RGBA canvas. Export caps: 2,200 pixels per dimension, 3.2 million pixels/page. Build a size preview for the exact PDF byte size.`;
      const scale = Math.min(1.25, 1500 / Math.max(view.width, view.height), Math.sqrt(2_000_000 / (view.width * view.height)));
      rendered = await renderPageImage(proxy, scale);
      if (disposed || epoch !== generation) return;
      canvas.width = rendered.width; canvas.height = rendered.height;
      const context = canvas.getContext('2d');
      if (!context) throw Error('Preview canvas is unavailable.');
      context.drawImage(rendered, 0, 0);
      overlay.width = canvas.width; overlay.height = canvas.height;
      overlay.style.aspectRatio = canvas.width + '/' + canvas.height;
      drawOverlay();
      progressText('Ready to mark areas', 0);
    } finally {
      if (rendered) { rendered.width = 1; rendered.height = 1; }
      proxy.cleanup();
    }
  };
  const point = (event: PointerEvent): { x: number; y: number } => {
    const bounds = overlay!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width))),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / Math.max(1, bounds.height)))
    };
  };
  if (overlay) {
    overlay.addEventListener('pointerdown', event => {
      if (!pdf || active || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault();
      const p = point(event);
      drag = { ...p, pointer: event.pointerId };
      overlay.setPointerCapture(event.pointerId);
    });
    overlay.addEventListener('pointermove', event => {
      if (!drag || drag.pointer !== event.pointerId || active) return;
      const p = point(event);
      drawOverlay(rectangleFromDrag(page, drag.x, drag.y, p.x, p.y));
    });
    const finish = (event: PointerEvent): void => {
      if (!drag || drag.pointer !== event.pointerId) return;
      const p = point(event);
      const area = rectangleFromDrag(page, drag.x, drag.y, p.x, p.y);
      drag = null;
      if (area.width >= .005 && area.height >= .005 && marks.length < 120) {
        marks.push(area); resetDownload();
      }
      drawOverlay();
    };
    overlay.addEventListener('pointerup', finish);
    overlay.addEventListener('pointercancel', () => { drag = null; drawOverlay(); });
  }
  coordForm?.addEventListener('submit', event => {
    event.preventDefault();
    if (!pdf || active) return;
    const values = new FormData(coordForm);
    const area = {
      page,
      x: Number(values.get('x')) / 100,
      y: Number(values.get('y')) / 100,
      width: Number(values.get('width')) / 100,
      height: Number(values.get('height')) / 100
    };
    try {
      validateRedactions([...marks, area], pdf.numPages);
      marks.push(area);
      showError(); resetDownload(); drawOverlay();
    } catch (e) { showError(e instanceof Error ? e.message : 'Invalid area.'); }
  });
  prev?.addEventListener('click', () => { if (!active && page > 1) { page--; void renderPreview().catch(e => showError(e instanceof Error ? e.message : 'Cannot render page.')); } });
  next?.addEventListener('click', () => { if (!active && pdf && page < pdf.numPages) { page++; void renderPreview().catch(e => showError(e instanceof Error ? e.message : 'Cannot render page.')); } });
  undo?.addEventListener('click', () => { marks.pop(); drawOverlay(); resetDownload(); });
  clear?.addEventListener('click', () => { marks = []; drawOverlay(); resetDownload(); });

  const chooseFile = async (): Promise<void> => {
    const epoch = ++generation;
    abort?.abort(); qpdf?.cancel(); qpdf = null;
    resetDownload();
    marks = []; page = 1; file = input.files?.[0] ?? null;
    if (confirm) confirm.checked = false;
    const old = pdf; pdf = null;
    if (old) await old.destroy();
    if (disposed || epoch !== generation) return;
    showError(); progressText('Ready',0); drawOverlay(); nav();
    if (!redact || !file) return;
    if (file.size > REDACTION_MAX_BYTES) { showError('File exceeds the 40 MB secure redaction limit.'); return; }
    try {
      const doc = await loadRedactionDocument(await file.arrayBuffer());
      if (disposed || epoch !== generation) { await doc.destroy(); return; }
      pdf = doc;
      nav();
      await renderPreview();
    } catch (e) {
      if (disposed || epoch !== generation) return;
      showError(e instanceof Error ? e.message : 'Could not open the PDF for redaction.');
    }
  };
  input.addEventListener('change', () => { void chooseFile(); });
  const runJob = async (previewOnly = false): Promise<void> => {
    if (active || disposed) return;
    if (!file) { showError('Choose a PDF first.'); return; }
    if (redact && (!pdf || !confirm?.checked)) { showError('Load the PDF and confirm the raster redaction warning before continuing.'); return; }
    if (redact && !marks.length) { showError('Mark at least one area on the PDF.'); return; }
    showError(); resetDownload(false);
    runtime.busy(true);
    active = true; if (dpi) dpi.disabled = true; if (sizePreview) sizePreview.disabled = true; drawOverlay(); input.disabled = true; run.disabled = true; cancel.disabled = false;
    nav();
    const currentAbort = new AbortController();
    abort = currentAbort;
    let timedOut=false;
    const deadline=setTimeout(()=>{timedOut=true;currentAbort.abort();qpdf?.cancel();},120000);
    try {
      const source = await file.arrayBuffer();
      if (currentAbort.signal.aborted) throw new DOMException('Cancelled','AbortError');
      if (redact) {
        const result = prepared ?? await redactPdf(source, marks, statusEvent => {
          if (!disposed) progressText(statusEvent.message, Math.min(97, Math.round(statusEvent.current / statusEvent.total * 97)));
        }, currentAbort.signal, Number(dpi?.value ?? 115.2));
        if (currentAbort.signal.aborted || disposed) return;
        if (previewOnly) {
          prepared = result;
          if (sizeResult) sizeResult.textContent = 'Export preview ready: ' + result.outputs[0]!.buffer.byteLength.toLocaleString() + ' bytes (' + (result.outputs[0]!.buffer.byteLength/1048576).toFixed(2) + ' MB). Apply permanent redactions to download this exact PDF. Changing areas or resolution discards the preview.';
        } else renderResult(result);
      } else {
        qpdf = runQpdfOperation('repair', { name: file.name, type: 'application/pdf', buffer: source }, '', update => {
          if (!disposed) progressText(update.message, update.percent);
        });
        const result = await qpdf.result;
        if (currentAbort.signal.aborted || disposed) return;
        // qpdf may recover structures that pdf-lib cannot parse, so PDF.js is the secondary verification engine.
        const bytes = result.outputs[0]?.buffer;
        if (!bytes) throw Error('qpdf returned no output.');
        const task = openLocalPdf(bytes.slice(0),currentAbort.signal);
        const verified = await task.promise;
        try {
          if (verified.numPages < 1) throw Error('The rewritten document contains no pages.');
          for (let pageNumber = 1; pageNumber <= verified.numPages; pageNumber++) {
            if (currentAbort.signal.aborted || disposed) throw new DOMException('Cancelled', 'AbortError');
            progressText('Validating repaired page ' + pageNumber + ' of ' + verified.numPages, 97);
            const checkedPage = await verified.getPage(pageNumber);
            try {await abortable(checkedPage.getOperatorList(),currentAbort.signal,()=>{void verified.destroy().catch(()=>{});});}
            finally {checkedPage.cleanup();}
          }
        } finally { if(currentAbort.signal.aborted)void verified.destroy().catch(()=>{});else await verified.destroy(); }
        if (currentAbort.signal.aborted || disposed) return;
        renderResult(result);
      }
      progressText('Complete',100);
    } catch (e) {
      if (disposed) return;
      progressText('Failed',0);
      showError(currentAbort.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')
        ? (timedOut ? 'The 120-second time limit was reached. No output was saved.' : 'Operation cancelled. No output was saved.')
        : e instanceof Error ? e.message : 'Operation failed.');
    } finally {
      clearTimeout(deadline);
      runtime.busy(false);
      qpdf = null;
      abort = null;
      active = false;
      if (!disposed) { if (dpi) dpi.disabled = false; if (sizePreview) sizePreview.disabled = false; drawOverlay(); run.disabled = false; input.disabled = false; cancel.disabled = true; nav(); }
    }
  };
  dpi?.addEventListener('change', () => { resetDownload(); void renderPreview().catch(e => showError(String(e))); });
  sizePreview?.addEventListener('click', () => { void runJob(true); });
  run.addEventListener('click', () => { void runJob(); });
  cancel.addEventListener('click', () => { abort?.abort(); qpdf?.cancel(); });
  container.addEventListener('docflow-cleanup', () => {
    disposed = true; generation++;
    abort?.abort(); qpdf?.cancel();
    const document = pdf; pdf = null;
    if (document) void document.destroy();
    marks = []; file = null; resetDownload();
  }, { once:true });
}
