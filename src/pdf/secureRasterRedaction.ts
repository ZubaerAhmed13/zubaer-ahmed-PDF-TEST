import * as pdfjs from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { OperationResult } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

export interface RedactionRect { page: number; x: number; y: number; width: number; height: number }
export interface RedactionProgress { current: number; total: number; message: string }
export const REDACTION_MAX_PAGES = 15;
export const REDACTION_MAX_BYTES = 40 * 1024 * 1024;
const MAX_PIXELS = 3_200_000;
const MAX_DIMENSION = 2200;

/** All coordinates are normalized within the *rendered, rotated* PDF.js viewport, top-left origin. */
export function validateRedactions(input: unknown, pages: number): RedactionRect[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 120) throw Error('Choose between one and 120 redaction areas.');
  return input.map((value) => {
    if (!value || typeof value !== 'object') throw Error('Invalid redaction area.');
    const item = value as Record<string, unknown>;
    const { page, x, y, width, height } = item;
    if (!Number.isInteger(page) || (page as number) < 1 || (page as number) > pages) throw Error('Redaction page is outside this PDF.');
    if (![x,y,width,height].every(v => typeof v === 'number' && Number.isFinite(v))) throw Error('Redaction coordinates must be finite numbers.');
    const rect = { page: page as number, x: x as number, y: y as number, width: width as number, height: height as number };
    if (rect.x < 0 || rect.y < 0 || rect.width < 0.005 || rect.height < 0.005 ||
        rect.x + rect.width > 1.000001 || rect.y + rect.height > 1.000001) throw Error('Redaction area must be inside the page.');
    return rect;
  });
}
export function rectangleFromDrag(page: number, ax: number, ay: number, bx: number, by: number): RedactionRect {
  const a = Math.max(0, Math.min(1, ax));
  const b = Math.max(0, Math.min(1, ay));
  const c = Math.max(0, Math.min(1, bx));
  const d = Math.max(0, Math.min(1, by));
  return { page, x: Math.min(a,c), y: Math.min(b,d), width: Math.abs(c-a), height: Math.abs(d-b) };
}
export function chooseRasterScale(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw Error('Invalid PDF page dimensions.');
  const pixels = width * height;
  return Math.min(1.6, MAX_DIMENSION / Math.max(width,height), Math.sqrt(MAX_PIXELS / pixels));
}
function assertNotCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Redaction cancelled', 'AbortError');
}
/** Render PDF visible content, including annotation appearances, without forwarding PDF objects to the output. */
export async function renderPageImage(page: PDFPageProxy, scale = 1.2): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) ||
      viewport.width < 10 || viewport.height < 10 || viewport.width * viewport.height > MAX_PIXELS + 5000)
    throw Error('Page canvas would exceed safe rendering limits.');
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) throw Error('Cannot create a local rendering canvas.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  try {
    await page.render({ canvasContext: context, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
    return canvas;
  } catch (error) {
    canvas.width = 1; canvas.height = 1;
    throw error;
  }
}
export function paintRedactions(canvas: HTMLCanvasElement, redactions: readonly RedactionRect[]): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw Error('Canvas is unavailable.');
  ctx.fillStyle = '#000';
  for (const rect of redactions) {
    // Expand outward by 2 pixels so antialiased boundary pixels cannot expose a glyph sliver.
    const left = Math.max(0, Math.floor(rect.x * canvas.width) - 2);
    const top = Math.max(0, Math.floor(rect.y * canvas.height) - 2);
    const right = Math.min(canvas.width, Math.ceil((rect.x + rect.width) * canvas.width) + 2);
    const bottom = Math.min(canvas.height, Math.ceil((rect.y + rect.height) * canvas.height) + 2);
    ctx.fillRect(left, top, right - left, bottom - top);
  }
}
async function pngBytes(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(value => value ? resolve(value) : reject(Error('Cannot encode rasterized page.')), 'image/png'));
  return blob.arrayBuffer();
}
export async function loadRedactionDocument(input: ArrayBuffer): Promise<PDFDocumentProxy> {
  if (input.byteLength > REDACTION_MAX_BYTES) throw Error('The maximum file size for privacy-safe redaction is 40 MB.');
  const document = await pdfjs.getDocument({ data: new Uint8Array(input) }).promise;
  if (document.numPages < 1 || document.numPages > REDACTION_MAX_PAGES) {
    await document.destroy();
    throw Error('Redaction supports 1–15 pages per PDF; split larger documents first.');
  }
  return document;
}
/**
 * Destructive pixel-level redaction: rebuilds an entirely new image-only PDF.
 * Does not reuse page content streams, fonts, metadata, attachments, form fields,
 * hidden layers, annotation objects or the original PDF's incremental revisions.
 */
export async function redactPdf(
  bytes: ArrayBuffer, marks: readonly RedactionRect[],
  progress: (event: RedactionProgress) => void, signal: AbortSignal
): Promise<OperationResult> {
  assertNotCancelled(signal);
  const pdf = await loadRedactionDocument(bytes);
  try {
    const validated = validateRedactions(marks, pdf.numPages);
    const out = await PDFDocument.create();
    out.setTitle('Redacted document');
    out.setAuthor('');
    out.setSubject('');
    out.setCreator('DocFlow local raster redaction');
    out.setProducer('DocFlow');
    for (let index = 1; index <= pdf.numPages; index++) {
      assertNotCancelled(signal);
      progress({ current: index - 1, total: pdf.numPages, message: 'Rasterizing page ' + index + ' of ' + pdf.numPages });
      const page = await pdf.getPage(index);
      let canvas: HTMLCanvasElement | null = null;
      try {
        const originalViewport = page.getViewport({ scale: 1 });
        canvas = await renderPageImage(page, chooseRasterScale(originalViewport.width, originalViewport.height));
        assertNotCancelled(signal);
        paintRedactions(canvas, validated.filter(mark => mark.page === index));
        const png = await pngBytes(canvas);
        assertNotCancelled(signal);
        const image = await out.embedPng(png);
        const newPage = out.addPage([originalViewport.width, originalViewport.height]);
        newPage.drawImage(image, { x: 0, y: 0, width: newPage.getWidth(), height: newPage.getHeight() });
      } finally {
        if (canvas) { canvas.width = 1; canvas.height = 1; }
        page.cleanup();
      }
      progress({ current: index, total: pdf.numPages, message: 'Removed original page objects: ' + index + '/' + pdf.numPages });
    }
    assertNotCancelled(signal);
    const output = await out.save({ useObjectStreams: true, updateFieldAppearances: false });
    assertNotCancelled(signal);
    return { outputs: [{ name: 'redacted-raster.pdf', type: 'application/pdf', buffer: output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer }],
      info: { pageCount: pdf.numPages, marks: validated.length, rasterized: true, selectableTextPreserved: false, originalPdfObjectsCopied: false } };
  } finally {
    await pdf.destroy();
  }
}
