import type { InputFile, OperationProgress, OperationResult, WorkerOperation, WorkerRequest } from './types';
import { validateInputBudget } from './resourceBudget';
import { taskWorker } from './taskWorker';
export interface RunningOperation { result:Promise<OperationResult>; cancel:()=>void }
export function runWorkerOperation(operation:WorkerOperation,files:InputFile[],options:Record<string,unknown>,onProgress:(p:OperationProgress)=>void):RunningOperation {
  validateInputBudget(files.map(file=>file.buffer.byteLength));
  const request:WorkerRequest={requestId:crypto.randomUUID(),operation,files,options};
  return taskWorker(new URL('../workers/pdf.worker.ts',import.meta.url),`docflow-${operation}`,request,files.map(file=>file.buffer),onProgress);
}
