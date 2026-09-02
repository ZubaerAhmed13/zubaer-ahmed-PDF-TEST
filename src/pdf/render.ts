import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

export interface PreviewController {
  pageCount: number;
  render: (pageNumber: number, scale?: number) => Promise<void>;
  destroy: () => Promise<void>;
}

export async function createPreview(buffer: ArrayBuffer, canvas: HTMLCanvasElement, status: HTMLElement): Promise<PreviewController> {
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const doc: PDFDocumentProxy = await loadingTask.promise;
  let currentTask: RenderTask | null = null;

  return {
    pageCount: doc.numPages,
    async render(pageNumber: number, scale = 1.25): Promise<void> {
      currentTask?.cancel();
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('CANVAS_CONTEXT_UNAVAILABLE');
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      status.textContent = `Rendering page ${pageNumber} of ${doc.numPages}`;
      currentTask = page.render({ canvasContext: context, viewport });
      try { await currentTask.promise; } catch (error) {
        if (!(error instanceof Error) || error.name !== 'RenderingCancelledException') throw error;
      } finally { page.cleanup(); }
      status.textContent = `Page ${pageNumber} of ${doc.numPages}`;
    },
    async destroy(): Promise<void> {
      currentTask?.cancel();
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
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const doc = await task.promise;
  const zip = new JSZip();
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    if (isCancelled()) { await doc.destroy(); throw new DOMException('Operation cancelled', 'AbortError'); }
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext('2d', { alpha: format === 'png' });
    if (!context) throw new Error('CANVAS_CONTEXT_UNAVAILABLE');
    const renderTask = page.render({ canvasContext: context, viewport });
    await renderTask.promise;
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('IMAGE_ENCODING_FAILED')), `image/${format}`, format === 'jpeg' ? 0.92 : undefined));
    zip.file(`page-${String(pageNumber).padStart(3, '0')}.${format === 'jpeg' ? 'jpg' : 'png'}`, blob);
    canvas.width = 1;
    canvas.height = 1;
    page.cleanup();
    onProgress(pageNumber, doc.numPages);
  }
  await doc.destroy();
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
