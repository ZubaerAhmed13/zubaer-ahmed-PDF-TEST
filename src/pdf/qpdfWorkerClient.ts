import type { InputFile, OperationProgress, OperationResult } from './types';
import type { QpdfOperation, QpdfRequest, QpdfResponse } from './qpdfTypes';

export interface RunningQpdfOperation {
  result: Promise<OperationResult>;
  cancel: () => void;
}

export function runQpdfOperation(
  operation: QpdfOperation,
  file: InputFile,
  password: string,
  onProgress: (progress: OperationProgress) => void
): RunningQpdfOperation {
  const worker = new Worker(new URL('../workers/qpdf.worker.ts', import.meta.url), { type: 'module', name: `docflow-qpdf-${operation}` });
  const requestId = crypto.randomUUID();
  let settled = false;
  let rejectPending: ((reason?: unknown) => void) | null = null;

  const result = new Promise<OperationResult>((resolve, reject) => {
    rejectPending = reject;
    worker.addEventListener('message', (event: MessageEvent<QpdfResponse>) => {
      const message = event.data;
      if (message.requestId !== requestId) return;
      if (message.type === 'progress') onProgress(message.progress);
      if (message.type === 'result') {
        settled = true;
        worker.terminate();
        resolve(message.result);
      }
      if (message.type === 'error') {
        settled = true;
        worker.terminate();
        const error = new Error(message.error.message);
        error.name = message.error.code;
        reject(error);
      }
    });
    worker.addEventListener('error', (event) => {
      settled = true;
      worker.terminate();
      reject(new Error(event.message || 'QPDF_WORKER_FAILURE'));
    }, { once: true });

    const request: QpdfRequest = { requestId, operation, file, password };
    worker.postMessage(request, [file.buffer]);
  });

  return {
    result,
    cancel: () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      rejectPending?.(new DOMException('Operation cancelled', 'AbortError'));
    }
  };
}
