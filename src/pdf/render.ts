import { fitRaster } from './resourceBudget';
import { openLocalPdf } from './pdfjsPolicy';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

export interface RenderedPage { page: import('pdfjs-dist').PDFPageProxy; viewport: ReturnType<import('pdfjs-dist').PDFPageProxy['getViewport']>; pageNumber: number; canvas: HTMLCanvasElement }
const renderedPages = new WeakMap<HTMLCanvasElement, RenderedPage>();
export const renderedPage = (canvas: HTMLCanvasElement): RenderedPage | undefined => renderedPages.get(canvas);
export interface PreviewController {
  pageCount: number;
  document: PDFDocumentProxy;
  render: (pageNumber: number, scale?: number) => Promise<void>;
  renderThumbnail: (pageNumber: number, canvas: HTMLCanvasElement, scale?: number) => Promise<boolean>;
  cancelThumbnails: () => void;
  destroy: () => Promise<void>;
}

export async function createPreview(buffer: ArrayBuffer, canvas: HTMLCanvasElement, status: HTMLElement, signal?: AbortSignal): Promise<PreviewController> {
  const loadingTask = openLocalPdf(buffer,signal);
  const doc: PDFDocumentProxy = await loadingTask.promise;
  let currentTask: RenderTask | null = null;
  let mainGeneration = 0;
  let destroyed = false;
  let thumbnailQueue = Promise.resolve();
  let thumbnailGeneration = 0;
  const thumbnailTasks = new Set<RenderTask>();

  const cancelThumbnails = (): void => {
    ++thumbnailGeneration;
    thumbnailTasks.forEach((task) => task.cancel());
    thumbnailTasks.clear();
  };

  return {
    pageCount: doc.numPages,
    document: doc,
    async render(pageNumber: number, scale = 1.25): Promise<void> {
      const generation = ++mainGeneration;
      const previousTask = currentTask; previousTask?.cancel();
      await previousTask?.promise.catch(() => {});
      const page = await doc.getPage(pageNumber);
      if (destroyed || generation !== mainGeneration) { page.cleanup(); return; }
      const base = page.getViewport({ scale: 1 });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const size = fitRaster(base.width, base.height, scale * pixelRatio, 4_000_000, 3000);
      // Keep the requested logical viewport for zoom, text layers and editor overlays; cap backing pixels only.
      const viewport = page.getViewport({ scale });
      const backingRatio = size.scale / scale;
      canvas.width = size.width;
      canvas.height = size.height;
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) { page.cleanup(); throw new Error('CANVAS_CONTEXT_UNAVAILABLE'); }
      context.setTransform(backingRatio, 0, 0, backingRatio, 0, 0);
      status.textContent = `Rendering page ${pageNumber} of ${doc.numPages}`;
      currentTask = page.render({ canvasContext: context, viewport });
      try {
        await currentTask.promise;
      } catch (error) {
        if (!(error instanceof Error) || error.name !== 'RenderingCancelledException') throw error;
        return;
      } finally {
        page.cleanup();
      }
      if (!destroyed && generation === mainGeneration) {
        status.textContent = `Page ${pageNumber} of ${doc.numPages}`;
        const detail = { page, viewport, pageNumber, canvas };
        renderedPages.set(canvas, detail);
        canvas.dispatchEvent(new CustomEvent('docflow-page-rendered', { bubbles: true, detail }));
      }
    },
    async renderThumbnail(pageNumber: number, target: HTMLCanvasElement, scale = 0.22): Promise<boolean> {
      const generation = thumbnailGeneration;
      const previous = thumbnailQueue; let release!: () => void; thumbnailQueue = new Promise<void>(resolve => {release=resolve;});
      await previous;
      try {
      if (destroyed || generation !== thumbnailGeneration) return false;
      const page = await doc.getPage(pageNumber);
      if (destroyed) { page.cleanup(); return false; }
      const base = page.getViewport({scale:1});
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      const size = fitRaster(base.width,base.height,scale*pixelRatio,300_000,600);
      const viewport = page.getViewport({scale:size.scale/pixelRatio});
      target.width = Math.max(1, Math.floor(viewport.width * pixelRatio));
      target.height = Math.max(1, Math.floor(viewport.height * pixelRatio));
      target.style.width = `${Math.max(1, Math.floor(viewport.width))}px`;
      target.style.height = `${Math.max(1, Math.floor(viewport.height))}px`;
      const context = target.getContext('2d', { alpha: false });
      if (!context) { page.cleanup(); throw new Error('CANVAS_CONTEXT_UNAVAILABLE'); }
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      const task = page.render({ canvasContext: context, viewport });
      thumbnailTasks.add(task);
      try {
        await task.promise;
        return !destroyed;
      } catch (error) {
        if (error instanceof Error && error.name === 'RenderingCancelledException') return false;
        throw error;
      } finally {
        thumbnailTasks.delete(task);
        page.cleanup();
      }
      } finally { release(); }
    },
    cancelThumbnails,
    async destroy(): Promise<void> {
      if(destroyed)return;
      renderedPages.delete(canvas);
      destroyed = true;
      mainGeneration += 1;
      currentTask?.cancel();
      cancelThumbnails();
      canvas.width = 1;
      canvas.height = 1;
      await doc.destroy();
    }
  };
}

export async function pdfToImages(
  buffer: ArrayBuffer,
  format: 'png' | 'jpeg',
  scale: number,
  onProgress: (completed: number, total: number) => void,
  isCancelled: () => boolean
): Promise<Blob> {
  const [{ default: JSZip }] = await Promise.all([import('jszip')]);
  const task = openLocalPdf(buffer);
  const doc = await task.promise;
  const zip = new JSZip();
  let encodedBytes = 0;
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      if (isCancelled()) throw new DOMException('Operation cancelled', 'AbortError');
      const page = await doc.getPage(pageNumber);
      const canvas = document.createElement('canvas');
      let cancellation: ReturnType<typeof setInterval> | undefined;
      try {
        const base = page.getViewport({scale:1});
        const size = fitRaster(base.width,base.height,scale);
        const viewport = page.getViewport({ scale: size.scale });
        canvas.width = size.width; canvas.height = size.height;
        const context = canvas.getContext('2d', { alpha: format === 'png' });
        if (!context) throw new Error('CANVAS_CONTEXT_UNAVAILABLE');
        const renderTask = page.render({ canvasContext: context, viewport });
        cancellation = setInterval(() => { if (isCancelled()) renderTask.cancel(); }, 100);
        await renderTask.promise;
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('IMAGE_ENCODING_FAILED')), `image/${format}`, format === 'jpeg' ? 0.92 : undefined));
        if (isCancelled()) throw new DOMException('Operation cancelled','AbortError');
        encodedBytes += blob.size;
        if (encodedBytes > 150*1048576) throw Error('Image export exceeds the 150 MB archive budget; export a smaller document.');
        zip.file(`page-${String(pageNumber).padStart(3, '0')}.${format === 'jpeg' ? 'jpg' : 'png'}`, blob);
        onProgress(pageNumber, doc.numPages);
      } finally { clearInterval(cancellation); canvas.width=canvas.height=1; page.cleanup(); }
    }
    const output = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    if (isCancelled()) throw new DOMException('Operation cancelled','AbortError');
    return output;
  } finally { await doc.destroy(); }
}
