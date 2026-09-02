import type { InputFile, OperationProgress, OperationResult, WorkerOperation, WorkerRequest, WorkerResponse } from './types';

export interface RunningOperation {
  result: Promise<OperationResult>;
  cancel: () => void;
}

export function runWorkerOperation(
  operation: WorkerOperation,
  files: InputFile[],
  options: Record<string, unknown>,
  onProgress: (progress: OperationProgress) => void
): RunningOperation {
  const worker = new Worker(new URL('../workers/pdf.worker.ts', import.meta.url), { type: 'module', name: `docflow-${operation}` });
  const requestId = crypto.randomUUID();
  let settled = false;
  let rejectPending: ((reason?: unknown) => void) | null = null;

  const result = new Promise<OperationResult>((resolve, reject) => {
    rejectPending = reject;
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
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
      reject(new Error(event.message || 'WORKER_FAILURE'));
    }, { once: true });
    const request: WorkerRequest = { requestId, operation, files, options };
    worker.postMessage(request, files.map((file) => file.buffer));
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
