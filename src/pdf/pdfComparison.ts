import * as pdfjs from 'pdfjs-dist';
import type { PDFPageProxy, TextContent } from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

export interface PageDifference {
  page: number;
  status: 'same' | 'different' | 'missing-left' | 'missing-right';
  textChanged: boolean;
  pixelDifferencePercent: number | null;
  leftExcerpt: string;
  rightExcerpt: string;
}
export interface ComparisonPreview {
  left: Blob;
  right: Blob;
  overlay: Blob;
  page: number;
}
export interface ComparisonResult {
  leftPages: number;
  rightPages: number;
  pagesCompared: number;
  changedPages: number;
  rows: PageDifference[];
  preview: ComparisonPreview | null;
  report: Blob;
  limited: boolean;
}

const RENDER_W = 440;
const RENDER_H = 600;

function textOf(items: TextContent['items']): string {
  const tokens: string[] = [];
  for (const item of items) if ('str' in item) tokens.push(item.str + (item.hasEOL ? '\n' : ' '));
  return tokens.join('').replace(/[ \t]+/g, ' ').trim();
}
export function normalizedComparisonText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}
export function classifyPagePair(left: string | null, right: string | null): Pick<PageDifference, 'status' | 'textChanged'> {
  if (left === null) return { status: 'missing-left', textChanged: true };
  if (right === null) return { status: 'missing-right', textChanged: true };
  const textChanged = normalizedComparisonText(left) !== normalizedComparisonText(right);
  return { status: textChanged ? 'different' : 'same', textChanged };
}
function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = RENDER_W;
  canvas.height = RENDER_H;
  return canvas;
}
async function rasterize(page: Awaited<ReturnType<Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>['getPage']>> | null): Promise<HTMLCanvasElement> {
  const canvas = makeCanvas();
  const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
  if (!ctx) throw Error('Canvas rendering is unavailable.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, RENDER_W, RENDER_H);
  if (!page) return canvas;
  const unscaled = page.getViewport({ scale: 1 });
  const scale = Math.min((RENDER_W - 14) / unscaled.width, (RENDER_H - 14) / unscaled.height, 1.6);
  const viewport = page.getViewport({ scale });
  const docCanvas = document.createElement('canvas');
  docCanvas.width = Math.max(1, Math.round(viewport.width));
  docCanvas.height = Math.max(1, Math.round(viewport.height));
  const dc = docCanvas.getContext('2d', { alpha: false });
  if (!dc) throw Error('Page rendering is unavailable.');
  await page.render({ canvasContext: dc, viewport }).promise;
  ctx.drawImage(docCanvas, Math.floor((RENDER_W - docCanvas.width) / 2), Math.floor((RENDER_H - docCanvas.height) / 2));
  docCanvas.width = 1;
  docCanvas.height = 1;
  return canvas;
}
function pixels(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw Error('Canvas pixel inspection is unavailable.');
  return ctx.getImageData(0, 0, RENDER_W, RENDER_H).data;
}
export function pixelDifference(left: Uint8ClampedArray, right: Uint8ClampedArray, threshold = 34): { percent: number; mask: Uint8ClampedArray } {
  if (left.length !== right.length || left.length % 4 !== 0) throw Error('Images have mismatched pixel buffers.');
  const mask = new Uint8ClampedArray(left.length);
  let changed = 0;
  for (let i = 0; i < left.length; i += 4) {
    const delta = Math.max(Math.abs(left[i]! - right[i]!), Math.abs(left[i + 1]! - right[i + 1]!), Math.abs(left[i + 2]! - right[i + 2]!));
    const different = delta > threshold;
    if (different) changed += 1;
    mask[i] = different ? 224 : Math.round((left[i]! + right[i]!) / 2);
    mask[i + 1] = different ? 57 : Math.round((left[i + 1]! + right[i + 1]!) / 2);
    mask[i + 2] = different ? 47 : Math.round((left[i + 2]! + right[i + 2]!) / 2);
    mask[i + 3] = 255;
  }
  return { percent: Math.round(changed / (left.length / 4) * 10000) / 100, mask };
}
async function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(Error('Failed to encode comparison image')), 'image/png'));
}

export async function comparePdfs(
  leftBuffer: ArrayBuffer, rightBuffer: ArrayBuffer,
  options: { mode: 'text' | 'visual' | 'both'; maxPages: number },
  progress: (done: number, total: number) => void, cancelled: () => boolean
): Promise<ComparisonResult> {
  const leftLoading = pdfjs.getDocument({ data: new Uint8Array(leftBuffer) });
  const rightLoading = pdfjs.getDocument({ data: new Uint8Array(rightBuffer) });
  let leftDoc: Awaited<typeof leftLoading.promise> | null = null;
  let rightDoc: Awaited<typeof rightLoading.promise> | null = null;
  try {
    [leftDoc, rightDoc] = await Promise.all([leftLoading.promise, rightLoading.promise]);
    const total = Math.max(leftDoc.numPages, rightDoc.numPages);
    const limit = Math.max(1, Math.min(50, Math.floor(options.maxPages)));
    const count = Math.min(limit, total);
    const rows: PageDifference[] = [];
    let preview: ComparisonPreview | null = null;
    for (let i = 1; i <= count; i++) {
      if (cancelled()) throw new DOMException('Comparison cancelled', 'AbortError');
      const l = i <= leftDoc.numPages ? await leftDoc.getPage(i) : null;
      const r = i <= rightDoc.numPages ? await rightDoc.getPage(i) : null;
      try {
        const [lt, rt] = options.mode === 'visual'
          ? ['', '']
          : await Promise.all([
            l?.getTextContent().then(v => textOf(v.items)) ?? Promise.resolve(null),
            r?.getTextContent().then(v => textOf(v.items)) ?? Promise.resolve(null)
          ]);
        let pixelDifferencePercent: number | null = null;
        if (options.mode !== 'text') {
          const [leftCanvas, rightCanvas] = await Promise.all([rasterize(l), rasterize(r)]);
          const { percent, mask } = pixelDifference(pixels(leftCanvas), pixels(rightCanvas));
          pixelDifferencePercent = percent;
          if (!preview && (percent > 0 || i === count)) {
            const overlayCanvas = makeCanvas();
            const ctx = overlayCanvas.getContext('2d');
            if (!ctx) throw Error('Comparison overlay is unavailable.');
            const imageData = ctx.createImageData(RENDER_W, RENDER_H);
            imageData.data.set(mask);
            ctx.putImageData(imageData, 0, 0);
            preview = { page: i, left: await toBlob(leftCanvas), right: await toBlob(rightCanvas), overlay: await toBlob(overlayCanvas) };
            overlayCanvas.width = 1;
            overlayCanvas.height = 1;
          }
          leftCanvas.width = 1;
          leftCanvas.height = 1;
          if (cancelled()) throw new DOMException('Comparison cancelled', 'AbortError');
        }
        const classification = classifyPagePair(l ? lt : null, r ? rt : null);
        const changed = classification.status.startsWith('missing') || (options.mode !== 'visual' && classification.textChanged) || (pixelDifferencePercent !== null && pixelDifferencePercent > 0.05);
        rows.push({
          page: i, status: changed ? classification.status === 'missing-left' ? 'missing-left' : classification.status === 'missing-right' ? 'missing-right' : 'different' : 'same',
          textChanged: options.mode !== 'visual' && classification.textChanged,
          pixelDifferencePercent, leftExcerpt: (lt ?? '').slice(0, 180), rightExcerpt: (rt ?? '').slice(0, 180)
        });
      } finally {
        l?.cleanup(); r?.cleanup();
      }
      progress(i, count);
    }
    const changedPages = rows.filter((p) => p.status !== 'same').length;
    const limited = count < total;
    const reportText = [
      'DocFlow PDF comparison — local analysis',
      'Document A: ' + leftDoc.numPages + ' pages',
      'Document B: ' + rightDoc.numPages + ' pages',
      'Mode: ' + options.mode,
      'Compared: ' + count + '/' + total + ' page positions',
      'Changed positions in range: ' + changedPages,
      limited ? 'WARNING: Incomplete comparison. Increase page limit to inspect remaining pages.' : 'All page positions compared.',
      ...rows.map((row) => [
        'Page ' + row.page + ': ' + row.status + (row.pixelDifferencePercent === null ? '' : '; changed pixels: ' + row.pixelDifferencePercent + '%'),
        row.leftExcerpt ? '  A text: ' + row.leftExcerpt.replace(/\n/g, ' ') : '',
        row.rightExcerpt ? '  B text: ' + row.rightExcerpt.replace(/\n/g, ' ') : ''
      ].filter(Boolean).join('\n'))
    ].join('\n');
    return { leftPages: leftDoc.numPages, rightPages: rightDoc.numPages, pagesCompared: count, changedPages, rows, preview, limited, report: new Blob([reportText], { type: 'text/plain;charset=utf-8' }) };
  } finally {
    await Promise.allSettled([
      leftDoc ? leftDoc.destroy() : leftLoading.destroy(),
      rightDoc ? rightDoc.destroy() : rightLoading.destroy()
    ]);
  }
}
