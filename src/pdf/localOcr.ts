import * as pdfjs from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';
import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';
import type { OperationResult } from './types';
import { createWorker } from 'tesseract.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

export type OcrLanguage = 'eng' | 'deu';
export interface OcrOptions { language: OcrLanguage; maxPages: number; skipExistingText: boolean }
export interface RecognizedWord { text: string; confidence: number; x: number; y: number; w: number; h: number }
export interface OcrResult { output: OperationResult; recognizedPages: number; skippedPages: number; words: number; warnings: string[] }

export function parseOcrTsv(value: string): RecognizedWord[] {
  const result: RecognizedWord[] = [];
  for (const line of value.split(/\r?\n/).slice(1)) {
    const cols = line.split('\t');
    if (cols.length < 12 || cols[0] !== '5') continue;
    const text = cols.slice(11).join('\t').trim();
    const [x, y, w, h, confidence] = [Number(cols[6]), Number(cols[7]), Number(cols[8]), Number(cols[9]), Number(cols[10])];
    if (!text || ![x,y,w,h,confidence].every(Number.isFinite) || w <= 0 || h <= 0 || confidence < 38) continue;
    result.push({ text, x, y, w, h, confidence });
    if (result.length >= 3000) break;
  }
  return result;
}
function fitWinAnsi(word: string, font: PDFFont): string {
  const candidate = word.replace(/[\u0000-\u001f]/g, '').slice(0, 100);
  try { font.encodeText(candidate); return candidate; } catch { /* unsupported font glyph */ }
  const reduced = candidate.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '');
  try { font.encodeText(reduced); return reduced; } catch { return ''; }
}
async function render(page: PDFPageProxy): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 2000 / Math.max(viewport.width, viewport.height), 2_000_000 / (viewport.width * viewport.height));
  const view = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(view.width));
  canvas.height = Math.max(1, Math.floor(view.height));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw Error('Browser canvas rendering is unavailable.');
  await page.render({ canvasContext: context, viewport: view }).promise;
  return canvas;
}
export async function ocrPdf(
  buffer: ArrayBuffer,
  options: OcrOptions,
  onProgress: (done: number, total: number, note: string) => void,
  signal: AbortSignal
): Promise<OcrResult> {
  if (!['eng', 'deu'].includes(options.language)) throw Error('Unsupported OCR language.');
  if (signal.aborted) throw new DOMException('OCR cancelled', 'AbortError');
  const { language, skipExistingText } = options;
  const original = buffer.slice(0);
  const pdf = await PDFDocument.load(original, { updateMetadata: false });
  const pdfjsTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const viewer = await pdfjsTask.promise;
  const maxPages = Math.max(1, Math.min(30, Math.floor(options.maxPages) || 10));
  const count = Math.min(viewer.numPages, maxPages);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  const local = new URL(base, location.origin).href;
  let tesseract: Awaited<ReturnType<typeof createWorker>> | null = null;
  let recognizedPages = 0;
  let skippedPages = 0;
  let totalWords = 0;
  const warnings: string[] = [];
  const texts: string[] = [];
  const abort = (): void => { if (tesseract) void tesseract.terminate(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (let pageNumber = 1; pageNumber <= count; pageNumber++) {
      if (signal.aborted) throw new DOMException('OCR cancelled', 'AbortError');
      const page = await viewer.getPage(pageNumber);
      try {
        const originalText = await page.getTextContent();
        const existing = originalText.items.reduce((s, item) => s + ('str' in item ? item.str : ''), '').trim();
        if (skipExistingText && existing.length >= 12) {
          skippedPages++;
          texts.push('--- Page ' + pageNumber + ': existing selectable text preserved ---\n' + existing);
          onProgress(pageNumber, count, 'Skipped page with existing text');
          continue;
        }
        if (page.rotate % 360 !== 0 || pdf.getPage(pageNumber - 1).getRotation().angle % 360 !== 0) {
          warnings.push('Page ' + pageNumber + ': rotated document requires correction before OCR; skipped to avoid misaligned text.');
          texts.push('--- Page ' + pageNumber + ': rotated, skipped ---');
          onProgress(pageNumber, count, 'Skipped rotated page');
          skippedPages++;
          continue;
        }
        if (!tesseract) {
          onProgress(pageNumber - 1, count, 'Loading local ' + language + ' OCR engine');
          const loading = createWorker(language, 1, {
            workerPath: local + 'ocr/worker.min.js',
            corePath: local + 'ocr/core',
            langPath: local + 'ocr/lang',
            gzip: true,
            workerBlobURL: false,
            cacheMethod: 'write'
          });
          tesseract = await loading;
        }
        const canvas = await render(page);
        try {
          const result = await tesseract.recognize(canvas, {}, { tsv: true });
          if (signal.aborted) throw new DOMException('OCR cancelled', 'AbortError');
          const words = parseOcrTsv(result.data.tsv ?? '');
          totalWords += words.length;
          recognizedPages++;
          texts.push('--- Page ' + pageNumber + ' ---\n' + result.data.text.trim());
          const p = pdf.getPage(pageNumber - 1);
          const crop = p.getCropBox();
          const dx = crop.width / canvas.width;
          const dy = crop.height / canvas.height;
          for (const word of words) {
            const printable = fitWinAnsi(word.text, font);
            if (!printable) continue;
            const width = Math.max(0.1, word.w * dx);
            let size = Math.max(2, Math.min(72, word.h * dy * 0.92));
            const calculated = font.widthOfTextAtSize(printable, size);
            if (calculated > width && calculated > 0) size *= width / calculated;
            if (size < 1) continue;
            p.drawText(printable, {
              x: crop.x + word.x * dx,
              y: crop.y + Math.max(0, crop.height - (word.y + word.h) * dy),
              size, font, opacity: 0
            });
          }
          if (!words.length) warnings.push('Page ' + pageNumber + ': no reliable words detected; inspect the result manually.');
        } finally {
          canvas.width = 1; canvas.height = 1;
        }
      } finally {
        page.cleanup();
      }
      onProgress(pageNumber, count, 'Recognised page ' + pageNumber + ' of ' + count);
    }
    if (count < viewer.numPages) warnings.push('Only first ' + count + ' of ' + viewer.numPages + ' pages processed; increase limit to continue.');
    const output = await pdf.save({ useObjectStreams: true });
    const recognized = new TextEncoder().encode(texts.join('\n\n'));
    return {
      output: {
        outputs: [
          { name: 'searchable-ocr.pdf', type: 'application/pdf', buffer: output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer },
          { name: 'ocr-recognized-text.txt', type: 'text/plain;charset=utf-8', buffer: recognized.buffer as ArrayBuffer }
        ],
        info: { recognizedPages, skippedPages, detectedWords: totalWords, totalPages: viewer.numPages, language, warning: warnings.join(' ') }
      },
      recognizedPages, skippedPages, words: totalWords, warnings
    };
  } finally {
    signal.removeEventListener('abort', abort);
    await Promise.allSettled([tesseract?.terminate(), viewer.destroy()]);
  }
}
