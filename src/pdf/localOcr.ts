import { assertOfflineOcr } from '../app/offline';
import * as pdfjs from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';
import { PDFDocument, beginText, endText, setFontAndSize, setTextMatrix, setTextRenderingMode, showText, pushGraphicsState, popGraphicsState, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { correctedCanvas, defaultScanOptions, type ScanOptions, type Point } from './scanProcessing';
import { parsePageSelection } from './pageRanges';
import type { OperationResult } from './types';
import { createWorker } from 'tesseract.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

export type OcrLanguage = 'eng' | 'deu' | 'eng+deu';
export interface OcrOptions { language: OcrLanguage; maxPages: number; skipExistingText: boolean; pages?: string; preprocessing?: ScanOptions }
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
export function addOcrWords(page: PDFPage, font: PDFFont, words: RecognizedWord[], toPdf: (x: number, y: number) => Point): number {
  const key = page.node.newFontDictionary('DocFlowOcr', font.ref);
  const supported = new Set(font.getCharacterSet());
  let omitted = 0;
  for (const word of words) {
    const text = word.text.replace(/\p{Cc}/gu, '').slice(0, 150);
    if (!text || [...text].some(c => !supported.has(c.codePointAt(0)!))) { omitted++; continue; }
    const origin = toPdf(word.x, word.y + word.h * .9), right = toPdf(word.x + word.w, word.y + word.h * .9), top = toPdf(word.x, word.y - word.h * .1);
    const width = Math.max(.01, font.widthOfTextAtSize(text, 1)), height = Math.max(.01, font.heightAtSize(1, { descender: false }));
    page.pushOperators(pushGraphicsState(), beginText(), setFontAndSize(key, 1), setTextRenderingMode(3), setTextMatrix((right.x - origin.x) / width, (right.y - origin.y) / width, (top.x - origin.x) / height, (top.y - origin.y) / height, origin.x, origin.y), showText(font.encodeText(text)), endText(), popGraphicsState());
  }
  return omitted;
}
async function render(page: PDFPageProxy): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale: 1 });
  const scale = Math.min(3, 2400 / Math.max(viewport.width, viewport.height), Math.sqrt(3_000_000 / (viewport.width * viewport.height)));
  const view = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(view.width));
  canvas.height = Math.max(1, Math.floor(view.height));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw Error('Browser canvas rendering is unavailable.');
  await page.render({ canvasContext: context, viewport: view }).promise;
  return canvas;
}
export async function ocrPreview(buffer: ArrayBuffer, pageNumber: number, options: ScanOptions) {
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const viewer = await task.promise;
  try {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > viewer.numPages) throw Error('Choose a page inside the document.');
    const page = await viewer.getPage(pageNumber);
    try { const original = await render(page); return { original, corrected: correctedCanvas(original, options).canvas }; }
    finally { page.cleanup(); }
  } finally { await viewer.destroy(); }
}
export async function ocrPdf(
  buffer: ArrayBuffer,
  options: OcrOptions,
  onProgress: (done: number, total: number, note: string) => void,
  signal: AbortSignal
): Promise<OcrResult> {
  if (!['eng', 'deu', 'eng+deu'].includes(options.language)) throw Error('Unsupported OCR language.');
  if (signal.aborted) throw new DOMException('OCR cancelled', 'AbortError');
  const { language, skipExistingText } = options;
  const original = buffer.slice(0);
  const pdf = await PDFDocument.load(original, { updateMetadata: false });
  const maxPages = Math.max(1, Math.min(30, Math.floor(options.maxPages) || 10));
  const selection = parsePageSelection(options.pages ?? '', pdf.getPageCount());
  const selected = selection.slice(0, maxPages);
  const count = selected.length;
  let font: PDFFont | null = null;
  const preprocessing = options.preprocessing ?? defaultScanOptions;
  const pdfjsTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const viewer = await pdfjsTask.promise;
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  const local = new URL(base, location.origin).href;
  let tesseract: Awaited<ReturnType<typeof createWorker>> | null = null;
  let progressIndex = 0, progressPage = 1;
  let recognizedPages = 0;
  let skippedPages = 0;
  let totalWords = 0;
  const warnings: string[] = [];
  const texts: string[] = [];
  const abort = (): void => { if (tesseract) void tesseract.terminate(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (const [index, pageIndex] of selected.entries()) {
      const pageNumber = pageIndex + 1; progressIndex = index; progressPage = pageNumber;
      if (signal.aborted) throw new DOMException('OCR cancelled', 'AbortError');
      const page = await viewer.getPage(pageNumber);
      try {
        const originalText = await page.getTextContent();
        const existing = originalText.items.reduce((s, item) => s + ('str' in item ? item.str : ''), '').trim();
        if (skipExistingText && existing.length >= 12) {
          skippedPages++;
          texts.push('--- Page ' + pageNumber + ': existing selectable text preserved ---\n' + existing);
          onProgress(index + 1, count, 'Skipped page ' + pageNumber + ' with existing text');
          continue;
        }
        if (!tesseract) {
          onProgress(pageNumber - 1, count, 'Loading local ' + language + ' OCR engine');
          for (const lang of language.split('+')) await assertOfflineOcr(lang as 'eng' | 'deu');
          const loading = createWorker(language.split('+'), 1, {
            workerPath: local + 'ocr/worker.min.js',
            corePath: local + 'ocr/core',
            langPath: local + 'ocr/lang',
            gzip: false,
            workerBlobURL: false,
            cacheMethod: 'none',
            logger: message => { if (!signal.aborted) onProgress(progressIndex, count, 'Page ' + progressPage + ': ' + message.status + ' ' + Math.round(message.progress * 100) + '%'); }
          });
          tesseract = await loading;
          if (signal.aborted) throw new DOMException('OCR cancelled', 'AbortError');
        }
        const canvas = await render(page);
        const corrected = correctedCanvas(canvas, preprocessing);
        try {
          const result = await tesseract.recognize(corrected.canvas, {}, { tsv: true });
          if (signal.aborted) throw new DOMException('OCR cancelled', 'AbortError');
          const words = parseOcrTsv(result.data.tsv ?? '');
          totalWords += words.length;
          recognizedPages++;
          texts.push('--- Page ' + pageNumber + ' ---\n' + result.data.text.trim());
          if (words.length && !font) {
            const response = await fetch(local + 'fonts/DocFlowSans.woff', { signal });
            if (!response.ok) throw Error('The local Unicode font could not be loaded. Reconnect or prepare Core PDF tools for offline use.');
            pdf.registerFontkit(fontkit); font = await pdf.embedFont(await response.arrayBuffer(), { subset: true });
          }
          const viewport = page.getViewport({ scale: 1 });
          const toPdf = (x: number, y: number): Point => {
            const source = corrected.toSource(x, y);
            const [px, py] = viewport.convertToPdfPoint(source.x * viewport.width / canvas.width, source.y * viewport.height / canvas.height);
            return { x: px!, y: py! };
          };
          if (font) {
            const omitted = addOcrWords(pdf.getPage(pageIndex), font, words, toPdf);
            if (omitted) warnings.push('Page ' + pageNumber + ': ' + omitted + ' words contained unsupported glyphs; see the UTF-8 text report.');
          }
          if (words.length === 3000) warnings.push('Page ' + pageNumber + ': overlay reached the 3000-word limit; the text report may contain additional words.');
          if (words.length) warnings.push('Page ' + pageNumber + ': overlay includes words at confidence 38 or above, up to 3000; inspect the full recognized-text report for uncertain or omitted words.');
          if (!words.length) warnings.push('Page ' + pageNumber + ': no reliable words detected; inspect the result manually.');
        } finally {
          canvas.width = canvas.height = corrected.canvas.width = corrected.canvas.height = 1;
        }
      } finally {
        page.cleanup();
      }
      onProgress(index + 1, count, 'Recognised source page ' + pageNumber + ' (' + (index + 1) + ' of ' + count + ')');
    }
    const untouched = Array.from({ length: viewer.numPages }, (_, i) => i).filter(i => !selected.includes(i)).map(i => i + 1);
    if (untouched.length) warnings.push('Unprocessed pages preserved unchanged: ' + untouched.join(', ') + '. Choose these pages to retry from the original document.');
    if (selection.length > count) warnings.push('The selected range exceeds the chunk limit; only ' + count + ' selected pages processed.');
    signal.throwIfAborted();
    const output = await pdf.save({ useObjectStreams: true });
    const recognized = new TextEncoder().encode(texts.join('\n\n'));
    return {
      output: {
        outputs: [
          { name: 'searchable-ocr.pdf', type: 'application/pdf', buffer: output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer },
          { name: 'ocr-recognized-text.txt', type: 'text/plain;charset=utf-8', buffer: recognized.buffer as ArrayBuffer }
        ],
        info: { recognizedPages, skippedPages, detectedWords: totalWords, totalPages: viewer.numPages, language, selectedPages: selected.map(i => i + 1).join(', '), unprocessedPages: untouched.join(', '), warning: warnings.join(' ') }
      },
      recognizedPages, skippedPages, words: totalWords, warnings
    };
  } finally {
    signal.removeEventListener('abort', abort);
    await Promise.allSettled([tesseract?.terminate(), viewer.destroy()]);
  }
}
