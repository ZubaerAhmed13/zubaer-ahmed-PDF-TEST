import {createPreview,type PreviewController} from '../pdf/render';
export type PdfReviewData={kind:'pdf';title:string;buffer:ArrayBuffer};

/** Review renders a copy of the exact downloadable bytes, never a regeneration. */
export function mountPdfReview(host:HTMLElement,data:PdfReviewData):()=>void{
  const heading=document.createElement('h2');heading.textContent=data.title;
  const nav=document.createElement('div');nav.className='df2-review-nav';
  const previous=document.createElement('button'),next=document.createElement('button'),status=document.createElement('p');
  previous.type=next.type='button';previous.textContent='Previous output page';next.textContent='Next output page';previous.disabled=next.disabled=true;
  status.dataset.pdfReviewStatus='';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.textContent='Opening exported PDF…';nav.append(previous,status,next);
  const canvas=document.createElement('canvas');canvas.dataset.pdfReviewCanvas='';canvas.className='df2-result-pdf';canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Exported PDF page');host.append(heading,nav,canvas);
  let controller:PreviewController|null=null,disposed=false,page=1,busy=false;
  const abort=new AbortController();
  const show=async(target:number):Promise<void>=>{
    if(!controller||disposed||busy)return;busy=true;previous.disabled=next.disabled=true;
    try{
      const proxy=await controller.document.getPage(target),viewport=proxy.getViewport({scale:1});
      if(disposed)return;
      const scale=Math.min(1.4,Math.max(.2,(host.clientWidth-24)/viewport.width));
      await controller.render(target,scale);if(disposed)return;canvas.style.height='auto';page=target;status.textContent=`Page ${page} / ${controller.pageCount} · Review before sharing.`;
    }catch(error){if(!disposed)status.textContent=error instanceof Error?error.message:'Output preview unavailable. Download and review the PDF before sharing.';}
    finally{busy=false;if(!disposed&&controller){previous.disabled=page<=1;next.disabled=page>=controller.pageCount;}}
  };
  const prior=():void=>{if(page>1)void show(page-1);};
  const following=():void=>{if(controller&&page<controller.pageCount)void show(page+1);};
  previous.addEventListener('click',prior);next.addEventListener('click',following);
  void createPreview(data.buffer.slice(0),canvas,status,abort.signal).then(async preview=>{if(disposed){await preview.destroy();return;}controller=preview;await show(1);}).catch(error=>{if(!disposed)status.textContent=error instanceof Error?error.message:'Output preview unavailable.';});
  return ()=>{disposed=true;abort.abort();previous.removeEventListener('click',prior);next.removeEventListener('click',following);void controller?.destroy();controller=null;canvas.width=canvas.height=1;host.replaceChildren();};
}
