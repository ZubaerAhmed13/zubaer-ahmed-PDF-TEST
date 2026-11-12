import type { PreviewController } from '../pdf/render';

export interface ThumbnailRail { dispose(): void; }

/** Recycle an off-screen bitmap first. Visible previews should not invalidate
 * one another when more than 32 page cards intersect the viewport. */
export function thumbnailEvictionCandidate<T>(retained:ReadonlySet<T>,visible:ReadonlySet<T>):T|undefined{
  for(const item of retained)if(!visible.has(item))return item;
  return undefined;
}

/**
 * All page numbers are navigable immediately, while page bitmaps are rendered
 * only when the user scrolls them into view. Canvas retention is bounded.
 */
export function mountPdfThumbnailRail(host:HTMLElement, pdf:PreviewController):ThumbnailRail{
  const maxRetained=32;
  const retained=new Set<HTMLCanvasElement>();
  const visible=new Set<HTMLCanvasElement>();
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

  const enqueue=(canvas:HTMLCanvasElement):void=>{
    if(disposed||canvas.dataset.thumbnailState!=='idle'||!visible.has(canvas))return;
    const page=Number(canvas.dataset.lazyPage);
    if(!Number.isInteger(page)||page<1||page>pdf.pageCount)return;
    canvas.dataset.thumbnailState='queued';
    queued.push({page,canvas});
  };
  const drain=async():Promise<void>=>{
    if(rendering||disposed)return;
    rendering=true;
    try{
      while(queued.length&&!disposed){
        const item=queued.shift()!;
        const canvas=item.canvas;
        if(canvas.dataset.thumbnailState!=='queued'||!canvas.isConnected)continue;
        if(!visible.has(canvas)){canvas.dataset.thumbnailState='idle';continue;}
        if(retained.size>=maxRetained){
          const victim=thumbnailEvictionCandidate(retained,visible);
          if(!victim){
            // Keep the card addressable; retry when an existing bitmap leaves view.
            canvas.dataset.thumbnailState='idle';
            continue;
          }
          retained.delete(victim);
          victim.width=1;victim.height=1;
          victim.dataset.thumbnailState='idle';
        }
        try {
          const ok=await pdf.renderThumbnail(item.page,canvas,.18);
          if(disposed)break;
          if(!ok){canvas.dataset.thumbnailState='error';continue;}
          canvas.dataset.thumbnailState='done';
          retained.add(canvas);
        }catch{
          if(!disposed)canvas.dataset.thumbnailState='error';
        }
      }
    }finally{rendering=false;}
  };
  const onVisibility=(entries:IntersectionObserverEntry[]):void=>{
    if(disposed)return;
    let changed=false;
    for(const item of entries){
      const canvas=item.target as HTMLCanvasElement;
      if(item.isIntersecting){
        if(!visible.has(canvas)){visible.add(canvas);changed=true;}
      }else if(visible.delete(canvas))changed=true;
    }
    if(changed)for(const canvas of visible)enqueue(canvas);
    void drain();
  };
  const canvases=[...host.querySelectorAll<HTMLCanvasElement>('[data-lazy-page]')];
  if('IntersectionObserver' in window){
    observer=new IntersectionObserver(onVisibility,{rootMargin:'125px'});
    canvases.forEach(c=>observer?.observe(c));
  }else {
    canvases.slice(0,24).forEach(canvas=>{visible.add(canvas);enqueue(canvas);});
    void drain();
  }
  return{dispose:()=>{
    disposed=true;observer?.disconnect();observer=null;
    queued.splice(0);
    visible.clear();
    retained.forEach(c=>{c.width=1;c.height=1;});
    retained.clear();
    host.replaceChildren();
  }};
}
