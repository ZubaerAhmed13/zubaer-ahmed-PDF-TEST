import { getDocument } from 'pdfjs-dist';
import { MAX_PAGES, SAFE_PDF_OPTIONS, validateInputBudget, WORKER_TIME_LIMIT_MS } from './resourceBudget';
/** No URL input, remote resources, XFA runtime or PDF scripting sandbox is configured. */
export function openLocalPdf(buffer:ArrayBuffer,signal?:AbortSignal) {
  validateInputBudget([buffer.byteLength]);
  signal?.throwIfAborted();
  const task=getDocument({...SAFE_PDF_OPTIONS,data:new Uint8Array(buffer)});
  let timer:ReturnType<typeof setTimeout>;
  const abort=():void => {void task.destroy().catch(()=>{});};
  const deadline=new Promise<never>((_,reject) => {timer=setTimeout(()=>{abort();reject(Error('PDF loading reached the 120-second time limit.'));},WORKER_TIME_LIMIT_MS);});
  signal?.addEventListener('abort',abort,{once:true});
  const promise=Promise.race([task.promise,deadline]).then(async doc => {
    if (signal?.aborted || doc.numPages<1 || doc.numPages>MAX_PAGES) {await doc.destroy();signal?.throwIfAborted();throw Error('PDF preview supports 1–1000 pages.');}
    return doc;
  }).catch(async error => {await task.destroy().catch(()=>{});throw error;}).finally(()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);});
  return {promise,destroy:()=>task.destroy()};
}
