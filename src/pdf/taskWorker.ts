import type { OperationProgress, OperationResult } from './types';
import { acquireWorkerSlot, WORKER_TIME_LIMIT_MS } from './resourceBudget';
/** Owns one worker, one transfer and one deadline; every exit releases the slot. */
export function taskWorker(createWorker:()=>Worker,request:{requestId:string},transfers:ArrayBuffer[],onProgress:(p:OperationProgress)=>void) {
  const requestId = request.requestId;
  const release = acquireWorkerSlot();
  let worker: Worker;
  try { worker = createWorker(); } catch(error) {release();throw error;}
  let settled=false;
  let rejectPending:(reason:unknown)=>void=()=>{};
  let timer:ReturnType<typeof setTimeout>;
  const finish = ():void => {settled=true;clearTimeout(timer);worker.terminate();release();};
  const result = new Promise<OperationResult>((resolve,reject) => {
    rejectPending=reject;
    timer=setTimeout(() => { if (!settled) {finish();reject(Error('Document processing reached the 120-second time limit. Try fewer pages or a smaller file.'));} },WORKER_TIME_LIMIT_MS);
    worker.addEventListener('message',(event:MessageEvent) => {
      const message=event.data;
      if (settled || message.requestId !== requestId) return;
      if (message.type==='progress') onProgress(message.progress);
      if (message.type==='result') {finish();resolve(message.result);}
      if (message.type==='error') {finish();const error=new Error(message.error.message);error.name=message.error.code;reject(error);}
    });
    worker.addEventListener('error',(event) => {if (!settled) {finish();reject(Error(event.message || 'Document worker failed.'));}},{once:true});
    try {worker.postMessage(request,transfers);} catch(error) {finish();reject(error);}
  });
  return {result,cancel:():void => {if (!settled) {finish();rejectPending(new DOMException('Operation cancelled','AbortError'));}}};
}
