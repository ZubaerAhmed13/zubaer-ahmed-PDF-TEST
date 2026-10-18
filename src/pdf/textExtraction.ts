import { abortable, cancellationScope } from './pdfCancellation';
import { openLocalPdf } from './pdfjsPolicy';
import * as pdfjs from 'pdfjs-dist';
import type { OperationResult } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

export interface SearchHit { page: number; count: number; sample: string }
export interface TextSearchResult { result: OperationResult; hits: SearchHit[]; pageCount: number; scannedPages: number }

export function markdownText(pages: string[]): string {
  // Literal content only: do not invent headings, table structure or reading order.
  return pages.map((text, i) => '## Page ' + (i + 1) + '\n\n' + text.replace(/&/g, '&amp;').replace(/[\\`*_{}[\]<>()#+.!|~-]/g, '\\$&').replace(/\n/g, '  \n')).join('\n\n---\n\n');
}
/** Extract selectable PDF text locally, preserving page boundaries. This is not OCR. */
export async function extractAndSearchText(
  data: ArrayBuffer, query: string, onProgress: (current: number, total: number) => void,
  cancelled: () => boolean
): Promise<TextSearchResult> {
  if (query.length > 150) throw new Error('Search phrase is too long (150 characters max).');
  const scope = cancellationScope(cancelled);
  const task = (()=>{try{return openLocalPdf(data,scope.signal);}catch(error){scope.dispose();throw error;}})();
  const doc = await task.promise.catch(error=>{scope.dispose();throw error;});
  const pages: string[] = [];
  const hits: SearchHit[] = [];
  let scannedPages = 0;
  try {
    for (let i = 1; i <= doc.numPages; i += 1) {
      if (cancelled()) throw new DOMException('Operation cancelled', 'AbortError');
      const page = await doc.getPage(i);
      try {
        const content = await abortable(page.getTextContent(),scope.signal);
        const chunks: string[] = [];
        for (const item of content.items) {
          if ('str' in item) chunks.push(item.str + (item.hasEOL ? '\n' : ' '));
        }
        const pageText = chunks.join('').replace(/[ \t]+/g, ' ').trim();
        if (!pageText) scannedPages += 1;
        pages.push(pageText);
        if (query.trim() && pageText) {
          const haystack = pageText.toLocaleLowerCase();
          const needle = query.trim().toLocaleLowerCase();
          let start = 0;
          let count = 0;
          let firstIndex = -1;
          while ((start = haystack.indexOf(needle, start)) !== -1) {
            if (firstIndex < 0) firstIndex = start;
            count++;
            start += Math.max(needle.length, 1);
          }
          if (count) {
            const snippet = pageText.slice(Math.max(0, firstIndex - 65), Math.min(pageText.length, firstIndex + needle.length + 85))
              .replace(/\s+/g, ' ');
            hits.push({ page: i, count, sample: snippet });
          }
        }
      } finally { page.cleanup(); }
      onProgress(i, doc.numPages);
    }
  } finally { scope.dispose(); await doc.destroy(); }
  const plain = pages.map((value, i) => '--- Page ' + (i + 1) + ' ---\n' + value).join('\n\n');
  const output = new TextEncoder().encode(plain);
  return {
    result: {
      outputs: [{ name: 'extracted-text.txt', type: 'text/plain;charset=utf-8', buffer: output.buffer as ArrayBuffer }, { name: 'extracted-text.md', type: 'text/markdown;charset=utf-8', buffer: new TextEncoder().encode(markdownText(pages)).buffer as ArrayBuffer }],
      info: {
        pageCount: pages.length, scannedOrEmptyPages: scannedPages, matchedPages: hits.length,
        totalMatches: hits.reduce((sum, hit) => sum + hit.count, 0),
        note: scannedPages ? 'Pages with no selectable text require OCR; no OCR was performed.' : 'Text extracted from the selectable layer.'
      }
    },
    hits, pageCount: pages.length, scannedPages
  };
}
