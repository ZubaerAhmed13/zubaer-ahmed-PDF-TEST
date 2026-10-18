import type { PDFPageProxy } from 'pdfjs-dist';
import { fitRaster } from './resourceBudget';
export function abortable<T>(promise:Promise<T>,signal:AbortSignal,onAbort:()=>void=()=>{}):Promise<T> {
  if(signal.aborted){onAbort();return Promise.reject(new DOMException('Operation cancelled','AbortError'));}
  return new Promise<T>((resolve,reject)=>{
    const abort=():void=>{reject(new DOMException('Operation cancelled','AbortError'));onAbort();};
    signal.addEventListener('abort',abort,{once:true});
    void promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
export function cancellationScope(cancelled:()=>boolean) {
  const controller=new AbortController();
  const timer=setInterval(()=>{if(cancelled())controller.abort();},100);
  if(cancelled())controller.abort();
  return {signal:controller.signal,dispose:()=>clearInterval(timer)};
}
export async function renderBoundedPage(page:PDFPageProxy,scale:number,signal:AbortSignal,maxPixels=3_000_000,maxDimension=2400):Promise<HTMLCanvasElement> {
  signal.throwIfAborted();
  const base=page.getViewport({scale:1}),size=fitRaster(base.width,base.height,scale,maxPixels,maxDimension);
  const canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;
  try {
    const context=canvas.getContext('2d',{alpha:false});if(!context)throw Error('Browser canvas rendering is unavailable.');
    const task=page.render({canvasContext:context,viewport:page.getViewport({scale:size.scale})});
    await abortable(task.promise,signal,()=>task.cancel());signal.throwIfAborted();return canvas;
  } catch(error){canvas.width=canvas.height=1;throw error;}
}
