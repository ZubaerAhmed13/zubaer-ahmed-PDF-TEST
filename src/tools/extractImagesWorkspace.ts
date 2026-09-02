import * as pdfjs from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { ToolDefinition } from './registry';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

interface RasterImageSource {
  width: number;
  height: number;
  data?: Uint8Array | Uint8ClampedArray;
  bitmap?: ImageBitmap;
}

interface ExtractedImageRecord {
  page: number;
  index: number;
  source: 'xobject' | 'inline';
  sourceId: string;
  width: number;
  height: number;
  filename: string;
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

function isImageBitmap(value: unknown): value is ImageBitmap {
  return typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap;
}

async function resolvePageObject(page: PDFPageProxy, id: string): Promise<unknown> {
  const objects = page.objs as unknown as { get: (objectId: string, callback?: (value: unknown) => void) => unknown };
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`IMAGE_OBJECT_TIMEOUT:${id}`));
    }, 5000);
    const finish = (value: unknown): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(value);
    };
    try {
      const immediate = objects.get(id, finish);
      if (immediate !== undefined) finish(immediate);
    } catch (error) {
      window.clearTimeout(timeout);
      reject(error);
    }
  });
}

function normalizeRasterSource(value: unknown): RasterImageSource | ImageBitmap | null {
  if (isImageBitmap(value)) return value;
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<RasterImageSource>;
  if (candidate.bitmap && isImageBitmap(candidate.bitmap)) return candidate.bitmap;
  if (typeof candidate.width !== 'number' || typeof candidate.height !== 'number') return null;
  if (!candidate.data || !(candidate.data instanceof Uint8Array || candidate.data instanceof Uint8ClampedArray)) return null;
  return { width: candidate.width, height: candidate.height, data: candidate.data };
}

function canvasFromRaster(source: RasterImageSource | ImageBitmap): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  const width = source instanceof ImageBitmap ? source.width : source.width;
  const height = source instanceof ImageBitmap ? source.height : source.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width * height > 100_000_000) return null;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;

  if (isImageBitmap(source)) {
    context.drawImage(source, 0, 0);
    return canvas;
  }

  const bytes = source.data;
  if (!bytes) return null;
  const pixels = width * height;
  const rgba = new Uint8ClampedArray(pixels * 4);

  if (bytes.length === pixels * 4) {
    rgba.set(bytes);
  } else if (bytes.length === pixels * 3) {
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      const sourceOffset = pixel * 3;
      const targetOffset = pixel * 4;
      rgba[targetOffset] = bytes[sourceOffset] ?? 0;
      rgba[targetOffset + 1] = bytes[sourceOffset + 1] ?? 0;
      rgba[targetOffset + 2] = bytes[sourceOffset + 2] ?? 0;
      rgba[targetOffset + 3] = 255;
    }
  } else if (bytes.length === pixels) {
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      const value = bytes[pixel] ?? 0;
      const targetOffset = pixel * 4;
      rgba[targetOffset] = value;
      rgba[targetOffset + 1] = value;
      rgba[targetOffset + 2] = value;
      rgba[targetOffset + 3] = 255;
    }
  } else if (bytes.length === Math.ceil(width / 8) * height) {
    const stride = Math.ceil(width / 8);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const byte = bytes[y * stride + (x >> 3)] ?? 0;
        const value = ((byte >> (7 - (x & 7))) & 1) === 1 ? 255 : 0;
        const targetOffset = (y * width + x) * 4;
        rgba[targetOffset] = value;
        rgba[targetOffset + 1] = value;
        rgba[targetOffset + 2] = value;
        rgba[targetOffset + 3] = 255;
      }
    }
  } else {
    return null;
  }

  context.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas;
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG_ENCODING_FAILED')), 'image/png');
  });
}

async function extractEmbeddedImages(
  buffer: ArrayBuffer,
  onProgress: (message: string, percent: number) => void,
  isCancelled: () => boolean
): Promise<{ blob: Blob; count: number }> {
  const [{ default: JSZip }] = await Promise.all([import('jszip')]);
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const document = await loadingTask.promise;
  const zip = new JSZip();
  const manifest: ExtractedImageRecord[] = [];
  let extracted = 0;

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (isCancelled()) throw new DOMException('Operation cancelled', 'AbortError');
      const page = await document.getPage(pageNumber);
      try {
        const operatorList = await page.getOperatorList();
        const seenPageObjects = new Set<string>();
        let pageImageIndex = 0;

        for (let operationIndex = 0; operationIndex < operatorList.fnArray.length; operationIndex += 1) {
          if (isCancelled()) throw new DOMException('Operation cancelled', 'AbortError');
          const operation = operatorList.fnArray[operationIndex];
          const args = operatorList.argsArray[operationIndex] ?? [];
          let rawSource: unknown = null;
          let source: 'xobject' | 'inline' = 'inline';
          let sourceId = `inline-${operationIndex + 1}`;

          if (operation === pdfjs.OPS.paintImageXObject) {
            source = 'xobject';
            sourceId = String(args[0] ?? 'unknown');
            if (seenPageObjects.has(sourceId)) continue;
            seenPageObjects.add(sourceId);
            try { rawSource = await resolvePageObject(page, sourceId); } catch { continue; }
          } else if (operation === pdfjs.OPS.paintInlineImageXObject) {
            rawSource = args[0];
          } else {
            continue;
          }

          const normalized = normalizeRasterSource(rawSource);
          if (!normalized) continue;
          const canvas = canvasFromRaster(normalized);
          if (!canvas) continue;
          const png = await canvasToPng(canvas);
          pageImageIndex += 1;
          extracted += 1;
          const filename = `page-${String(pageNumber).padStart(3, '0')}-image-${String(pageImageIndex).padStart(3, '0')}.png`;
          zip.file(filename, png);
          manifest.push({
            page: pageNumber,
            index: pageImageIndex,
            source,
            sourceId,
            width: canvas.width,
            height: canvas.height,
            filename
          });
          canvas.width = 1;
          canvas.height = 1;
        }
      } finally {
        page.cleanup();
      }
      onProgress(`Scanned page ${pageNumber} of ${document.numPages}`, (pageNumber / document.numPages) * 90);
    }
  } finally {
    await document.destroy();
  }

  if (extracted === 0) throw new Error('No decoded embedded raster images were found. Image masks, vector graphics, and whole-page rendering are intentionally not treated as embedded-image extraction.');

  zip.file('manifest.json', JSON.stringify({
    tool: 'DocFlow Professional Extract Images',
    extractedImages: extracted,
    note: 'Images are exported from PDF.js decoded raster data as PNG. Original JPEG/JPX/compressed stream bytes and source metadata are not claimed to be preserved.',
    images: manifest
  }, null, 2));
  onProgress('Packaging extracted images', 95);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { blob, count: extracted };
}

export function mountWorkspace(container: HTMLDivElement, tool: ToolDefinition): void {
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
          <input id="workspace-file" type="file" accept=".pdf,application/pdf">
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
    run.disabled = true;
    cancel.disabled = false;
    setError();
    clearResult();
    setProgress('Opening PDF', 2);
    void file.arrayBuffer()
      .then((buffer) => extractEmbeddedImages(buffer, setProgress, () => cancelled))
      .then(({ blob, count }) => {
        if (cancelled) throw new DOMException('Operation cancelled', 'AbortError');
        objectUrl = URL.createObjectURL(blob);
        result.innerHTML = `<div class="notice"><strong>${count} embedded raster image${count === 1 ? '' : 's'} extracted</strong><p>The ZIP includes PNG files plus a manifest describing source pages and dimensions.</p></div><a class="download" href="${objectUrl}" download="embedded-images.zip">Download embedded-images.zip <span>${humanBytes(blob.size)}</span></a>`;
        setProgress('Complete', 100);
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
