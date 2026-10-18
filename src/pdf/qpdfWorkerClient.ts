import type { InputFile, OperationProgress, OperationResult } from './types';
import type { QpdfOperation, QpdfRequest } from './qpdfTypes';
import { validateInputBudget } from './resourceBudget';
import { taskWorker } from './taskWorker';
export interface RunningQpdfOperation {result:Promise<OperationResult>;cancel:()=>void}
export function runQpdfOperation(operation:QpdfOperation,file:InputFile,password:string,onProgress:(p:OperationProgress)=>void):RunningQpdfOperation {
  validateInputBudget([file.buffer.byteLength]);
  const request:QpdfRequest={requestId:crypto.randomUUID(),operation,file,password};
  const running = taskWorker(()=>new Worker(new URL('../workers/qpdf.worker.ts',import.meta.url),{type:'module',name:`docflow-qpdf-${operation}`}),request,[file.buffer],onProgress);
  request.password = '';
  return running;
}
