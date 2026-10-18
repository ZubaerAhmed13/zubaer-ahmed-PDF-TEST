import { abortable, cancellationScope, renderBoundedPage } from './pdfCancellation';
import { openLocalPdf } from './pdfjsPolicy';
import { alignPages, wordChanges, type TextChange, type PageSignature } from './pageAlignment';
import * as pdfjs from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

export interface PageDifference {
  page: number;
  leftPage: number | null;
  rightPage: number | null;
  moved: boolean;
  uncertain: boolean;
  changes: TextChange[];
  textLimited: boolean;
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
  previews: (ComparisonPreview | null)[];
  htmlReport: Blob;
  report: Blob;
  limited: boolean;
}

const RENDER_W = 440;
const RENDER_H = 600;

function textOf(items: readonly unknown[]): string {
  const tokens: string[] = [];
  for (const item of items) {
    if (item && typeof item === 'object' && 'str' in item && typeof item.str === 'string') {
      tokens.push(item.str + ('hasEOL' in item && item.hasEOL ? '\n' : ' '));
    }
  }
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
async function rasterize(page: PDFPageProxy | null, signal: AbortSignal): Promise<HTMLCanvasElement> {
  const canvas = makeCanvas();
  const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
  if (!ctx) throw Error('Canvas rendering is unavailable.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, RENDER_W, RENDER_H);
  if (!page) return canvas;
  const unscaled = page.getViewport({ scale: 1 });
  const scale = Math.min((RENDER_W - 14) / unscaled.width, (RENDER_H - 14) / unscaled.height, 1.6);
  try {
    const docCanvas = await renderBoundedPage(page,scale,signal);
    try {ctx.drawImage(docCanvas,Math.floor((RENDER_W-docCanvas.width)/2),Math.floor((RENDER_H-docCanvas.height)/2));}
    finally {docCanvas.width=docCanvas.height=1;}
  } catch(error) {canvas.width=canvas.height=1;throw error;}
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
  options: { mode: 'text' | 'visual' | 'both'; maxPages: number; threshold?: number; tolerance?: number },
  progress: (done: number, total: number) => void, cancelled: () => boolean
): Promise<ComparisonResult> {
  const scope = cancellationScope(cancelled);
  let leftLoading:ReturnType<typeof openLocalPdf>|null=null,rightLoading:ReturnType<typeof openLocalPdf>|null=null;
  try {leftLoading=openLocalPdf(leftBuffer,scope.signal);rightLoading=openLocalPdf(rightBuffer,scope.signal);}
  catch(error){scope.dispose();void leftLoading?.destroy();throw error;}
  let leftDoc: import('pdfjs-dist').PDFDocumentProxy | null = null;
  let rightDoc: Awaited<typeof rightLoading.promise> | null = null;
  const check = (): void => { if (cancelled()) throw new DOMException('Comparison cancelled', 'AbortError'); };
  try {
    [leftDoc, rightDoc] = await Promise.all([leftLoading.promise, rightLoading.promise]);
    const limit = Math.max(1, Math.min(50, Math.floor(options.maxPages) || 20));
    const threshold = Math.max(0, Math.min(255, options.threshold ?? 34)), tolerance = Math.max(0, Math.min(100, options.tolerance ?? .05));
    const signatures = async (doc: NonNullable<typeof leftDoc>): Promise<PageSignature[]> => {
      const result: PageSignature[] = [];
      for (let i = 1; i <= Math.min(limit, doc.numPages); i++) {
        check(); const page = await doc.getPage(i);
        try {
          const text = textOf((await abortable(page.getTextContent(),scope.signal)).items);
          let fingerprint: number[] | undefined;
          if (!text && options.mode !== 'text') {
            const canvas = await rasterize(page,scope.signal), tiny = document.createElement('canvas'); tiny.width = 24; tiny.height = 32;
            const ctx = tiny.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(canvas, 0, 0, 24, 32);
            const data = ctx.getImageData(0, 0, 24, 32).data; fingerprint = [];
            for (let k = 0; k < data.length; k += 4) fingerprint.push((data[k]! + data[k + 1]! + data[k + 2]!) / 3);
            canvas.width = canvas.height = tiny.width = tiny.height = 1;
          }
          result.push({ text, fingerprint });
        } finally { page.cleanup(); }
      }
      return result;
    };
    const ls = await signatures(leftDoc), rs = await signatures(rightDoc);
    const pairs = alignPages(ls, rs), rows: PageDifference[] = [], previews: (ComparisonPreview | null)[] = [];
    for (const [index, pair] of pairs.entries()) {
      check();
      const l = pair.left ? await leftDoc.getPage(pair.left) : null, r = pair.right ? await rightDoc.getPage(pair.right) : null;
      try {
        const lt = pair.left ? ls[pair.left - 1]!.text : '', rt = pair.right ? rs[pair.right - 1]!.text : '';
        let pixelDifferencePercent: number | null = null, preview: ComparisonPreview | null = null;
        if (options.mode !== 'text') {
          const lc = await rasterize(l,scope.signal); let rc:HTMLCanvasElement|null=null;
          try {
            rc = await rasterize(r,scope.signal);
            const { percent, mask } = pixelDifference(pixels(lc), pixels(rc), threshold); pixelDifferencePercent = percent;
            const overlay = makeCanvas(), ctx = overlay.getContext('2d')!;
            const data = ctx.createImageData(RENDER_W, RENDER_H); data.data.set(mask); ctx.putImageData(data, 0, 0);
            preview = { page: index + 1, left: await toBlob(lc), right: await toBlob(rc), overlay: await toBlob(overlay) }; overlay.width = overlay.height = 1;
          } finally { lc.width = lc.height = 1; if(rc)rc.width=rc.height=1; }
          check();
        }
        const classification = classifyPagePair(l ? lt : null, r ? rt : null);
        const changed = classification.status.startsWith('missing') || (options.mode !== 'visual' && classification.textChanged) || (pixelDifferencePercent !== null && pixelDifferencePercent > tolerance);
        const diff = options.mode === 'visual' ? { changes: [], truncated: false } : wordChanges(lt, rt);
        rows.push({ page: index + 1, leftPage: pair.left, rightPage: pair.right, moved: pair.moved, uncertain: pair.uncertain, changes: diff.changes, textLimited: diff.truncated,
          status: changed ? classification.status === 'missing-left' ? 'missing-left' : classification.status === 'missing-right' ? 'missing-right' : 'different' : 'same',
          textChanged: options.mode !== 'visual' && classification.textChanged, pixelDifferencePercent, leftExcerpt: lt.slice(0, 180), rightExcerpt: rt.slice(0, 180) });
        previews.push(preview);
      } finally { l?.cleanup(); r?.cleanup(); }
      progress(index + 1, pairs.length);
    }
    const changedPages = rows.filter(p => p.status !== 'same' || p.moved).length, limited = ls.length < leftDoc.numPages || rs.length < rightDoc.numPages;
    const label = (row: PageDifference): string => `Page ${row.page}: ${row.status} · A ${row.leftPage ?? '—'} ↔ B ${row.rightPage ?? '—'}${row.moved ? ' · moved' : ''}${row.uncertain ? ' · uncertain match: review manually' : ''}`;
    const disclaimer = `Mode: ${options.mode}. Visual threshold: ${threshold}/255; changed area tolerance: ${tolerance}%. Downscaled visual comparison can miss small changes. Page matching is heuristic; repeated/empty or heavily revised pages may be uncertain. Word changes stop at 600 words per side and are marked if incomplete. This is not semantic or legal review.`;
    const reportText = ['DocFlow PDF comparison — local analysis', `Document A: ${leftDoc.numPages} pages`, `Document B: ${rightDoc.numPages} pages`, disclaimer,
      limited ? 'WARNING: Incomplete comparison. Pages outside the selected first-page limits were not matched.' : 'All pages compared.',
      ...rows.map(row => [label(row), row.pixelDifferencePercent === null ? '' : `Changed pixels: ${row.pixelDifferencePercent}%`, ...row.changes.filter(c => c.kind !== 'same').map(c => `${c.kind}: ${c.text}`), row.textLimited ? 'WARNING: word diff incomplete (600-word limit).' : ''].filter(Boolean).join('\n'))].join('\n\n');
    const escape = (value: string): string => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>DocFlow comparison report</title><style>body{font:16px system-ui;max-width:900px;margin:32px auto;padding:0 20px;line-height:1.6}section{border-top:1px solid #bbb;padding:20px 0}ins{background:#d9f6df}del{background:#ffe0dc}a{color:#a33126}</style><h1>PDF comparison report</h1><p>${escape(disclaimer)}</p><p>${limited ? 'Incomplete comparison: pages beyond the limit were not matched.' : 'All pages compared.'} A: ${leftDoc.numPages} pages; B: ${rightDoc.numPages} pages.</p><nav aria-label="Page matches">${rows.map(row => `<a href="#pair-${row.page}">${escape(label(row))}</a><br>`).join('')}</nav>${rows.map(row => `<section id="pair-${row.page}"><h2>${escape(label(row))}</h2><p>${row.pixelDifferencePercent === null ? 'Text comparison' : `Changed pixels: ${row.pixelDifferencePercent}%`}</p><p>${row.changes.map(c => c.kind === 'added' ? `<ins>${escape(c.text)}</ins> ` : c.kind === 'removed' ? `<del>${escape(c.text)}</del> ` : escape(c.text) + ' ').join('')}</p>${row.textLimited ? '<p>Word diff incomplete: first 600 words only.</p>' : ''}<a href="#">Back to page matches</a></section>`).join('')}</html>`;
    return { leftPages: leftDoc.numPages, rightPages: rightDoc.numPages, pagesCompared: rows.length, changedPages, rows, previews, preview: previews[rows.findIndex(r => r.status !== 'same')] ?? previews[0] ?? null, limited, report: new Blob([reportText], { type: 'text/plain;charset=utf-8' }), htmlReport: new Blob([html], { type: 'text/html;charset=utf-8' }) };
  } finally { scope.dispose(); await Promise.allSettled([leftDoc ? leftDoc.destroy() : leftLoading.destroy(), rightDoc ? rightDoc.destroy() : rightLoading.destroy()]); }
}
