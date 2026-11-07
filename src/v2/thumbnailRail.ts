import type { PreviewController } from '../pdf/render';

export interface ThumbnailRail { dispose(): void; }

/**
 * All page numbers are navigable immediately, while page bitmaps are rendered
 * only when the user scrolls them into view. Canvas retention is bounded.
 */
export function mountPdfThumbnailRail(host:HTMLElement, pdf:PreviewController):ThumbnailRail{
  const maxRetained=32;
  const retained:HTMLCanvasElement[]=[];
  const queued:Array<{page:number;canvas:HTMLCanvasElement}>=[];
  let disposed=false,rendering=false;
  let observer:IntersectionObserver|null=null;
  const cards=document.createDocumentFragment();
  for(let page=1;page<=pdf.pageCount;page++){
    const card=document.createElement('button');
    card.type='button';card.className='df2-thumb';card.dataset.page=String(page);
    card.ariaLabel='Select page '+page;card.setAttribute('aria-pressed','false');
    const canvas=document.createElement('canvas');
    canvas.dataset.lazyPage=String(page);canvas.dataset.thumbnailState='idle';
    canvas.setAttribute('aria-hidden','true');
    const label=document.createElement('span');label.textContent='Page '+page;
    card.append(canvas,label);cards.append(card);
  }
  host.replaceChildren(cards);

  const drain=async():Promise<void>=>{
    if(rendering||disposed)return;
    rendering=true;
    try{
      while(queued.length&&!disposed){
        const item=queued.shift()!;
        if(item.canvas.dataset.thumbnailState!=='queued'||!item.canvas.isConnected)continue;
        try {
          const ok=await pdf.renderThumbnail(item.page,item.canvas,.18);
          if(disposed)break;
          item.canvas.dataset.thumbnailState=ok?'done':'error';
          if(ok){
            retained.push(item.canvas);
            if(retained.length>maxRetained){
              const old=retained.shift()!;
              // Avoid eviction of the currently visible canvas, reducing thrash.
              if(old!==item.canvas && old.isConnected){
                old.width=1;old.height=1;
                old.dataset.thumbnailState='idle';
                observer?.observe(old);
              }
            }
          }
        }catch{
          if(!disposed)item.canvas.dataset.thumbnailState='error';
        }
      }
    }finally{rendering=false;}
  };
  const onVisibility=(entries:IntersectionObserverEntry[]):void=>{
    for(const item of entries){
      if(!item.isIntersecting||disposed)continue;
      const canvas=item.target as HTMLCanvasElement;
      if(canvas.dataset.thumbnailState!=='idle')continue;
      const page=Number(canvas.dataset.lazyPage);
      if(!Number.isInteger(page)||page<1||page>pdf.pageCount)continue;
      canvas.dataset.thumbnailState='queued';
      observer?.unobserve(canvas);
      queued.push({page,canvas});
    }
    void drain();
  };
  const canvases=[...host.querySelectorAll<HTMLCanvasElement>('[data-lazy-page]')];
  if('IntersectionObserver' in window){
    observer=new IntersectionObserver(onVisibility,{rootMargin:'125px'});
    canvases.forEach(c=>observer?.observe(c));
  }else {
    canvases.slice(0,24).forEach((canvas,i)=>{
      canvas.dataset.thumbnailState='queued';queued.push({page:i+1,canvas});
    });
    void drain();
  }
  return{dispose:()=>{
    disposed=true;observer?.disconnect();observer=null;
    queued.splice(0);
    retained.splice(0).forEach(c=>{c.width=1;c.height=1;});
    host.replaceChildren();
  }};
}
