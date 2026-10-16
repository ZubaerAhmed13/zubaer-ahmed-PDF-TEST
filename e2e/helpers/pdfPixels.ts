import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

interface CanvasTarget { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }
interface CanvasFactory {
  create(width: number, height: number): CanvasTarget;
  destroy(target: CanvasTarget): void;
}
export interface PdfPixels { width: number; height: number; data: Uint8ClampedArray }

/** Independent PDF.js/Node rasterisation of downloaded bytes; no editor canvas reuse. */
export async function pdfPixels(bytes: Buffer, pageNumber: number): Promise<PdfPixels> {
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
  let target: CanvasTarget | null = null;
  const factory = doc.canvasFactory as CanvasFactory;
  try {
    const page = await doc.getPage(pageNumber);
    const view = page.getViewport({ scale: 1 });
    target = factory.create(Math.ceil(view.width), Math.ceil(view.height));
    await page.render({ canvasContext: target.context, viewport: view }).promise;
    const { width, height } = target.canvas;
    return { width, height, data: new Uint8ClampedArray(target.context.getImageData(0, 0, width, height).data) };
  } finally {
    if (target) factory.destroy(target);
    await doc.destroy();
  }
}
