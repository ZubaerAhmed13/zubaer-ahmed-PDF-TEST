import { abortable } from './pdfCancellation';
import { openLocalPdf } from './pdfjsPolicy';
import { WORKER_TIME_LIMIT_MS } from './resourceBudget';

/** Check the qpdf rewrite with a separate parser before releasing its bytes. */
export async function verifyRepairedPdf(
  bytes: ArrayBuffer, signal: AbortSignal, onPage: (page: number, total: number) => void,
): Promise<void> {
  const deadline = AbortSignal.timeout(WORKER_TIME_LIMIT_MS);
  const verification = AbortSignal.any([signal, deadline]);
  try {
    const doc = await openLocalPdf(bytes.slice(0), verification).promise;
    try {
      for (let index = 1; index <= doc.numPages; index++) {
        verification.throwIfAborted();
        onPage(index, doc.numPages);
        const page = await abortable(doc.getPage(index), verification);
        try { await abortable(page.getOperatorList(), verification); }
        finally { page.cleanup(); }
      }
      verification.throwIfAborted();
    } finally { await doc.destroy(); }
  } catch (error) {
    if (deadline.aborted && !signal.aborted) throw Error('Repaired PDF verification reached the 120-second time limit.');
    throw error;
  }
}
