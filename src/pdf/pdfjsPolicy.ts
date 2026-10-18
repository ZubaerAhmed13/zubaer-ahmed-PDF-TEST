import { getDocument, PDFWorker } from 'pdfjs-dist';
import { MAX_PAGES, SAFE_PDF_OPTIONS, validateInputBudget, WORKER_TIME_LIMIT_MS } from './resourceBudget';
/** Owns the parser worker, including teardown when the parser cannot acknowledge cancellation. */
export function openLocalPdf(buffer:ArrayBuffer,signal?:AbortSignal) {
  validateInputBudget([buffer.byteLength]);signal?.throwIfAborted();
  const worker=new PDFWorker();
  let task:ReturnType<typeof getDocument>;
  try {task=getDocument({...SAFE_PDF_OPTIONS,data:new Uint8Array(buffer),worker});}
  catch(error){worker.destroy();throw error;}
  let settled=false,forced=false;
  let rejectPending:(error:unknown)=>void=()=>{};
  let timer:ReturnType<typeof setTimeout>;
  let destruction:Promise<void>|null=null;
  const detach=():void=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  const teardown=(force=false):Promise<void>=>{
    detach();
    if(force){forced=true;worker.destroy();}
    if(forced){void task.destroy().catch(()=>{});return Promise.resolve();}
    if(destruction)return destruction;
    destruction=new Promise<void>(resolve=>{
      const deadline=setTimeout(()=>{worker.destroy();resolve();},500);
      void task.destroy().catch(()=>{}).finally(()=>{clearTimeout(deadline);worker.destroy();resolve();});
    });
    return destruction;
  };
  const stop=(error:unknown):void=>{if(!settled){settled=true;rejectPending(error);}void teardown(true);};
  const abort=():void=>stop(new DOMException('Operation cancelled','AbortError'));
  const promise=new Promise<Awaited<typeof task.promise>>((resolve,reject)=>{
    rejectPending=reject;
    timer=setTimeout(()=>stop(Error('PDF loading reached the 120-second time limit.')),WORKER_TIME_LIMIT_MS);
    signal?.addEventListener('abort',abort,{once:true});
    void task.promise.then(doc=>{
      if(settled){void teardown(true);return;}
      if(doc.numPages<1||doc.numPages>MAX_PAGES){stop(Error('PDF preview supports 1–1000 pages.'));return;}
      settled=true;clearTimeout(timer);
      doc.destroy=()=>teardown(Boolean(signal?.aborted));
      resolve(doc);
    },stop);
  });
  return {promise,destroy:()=>teardown(true)};
}
