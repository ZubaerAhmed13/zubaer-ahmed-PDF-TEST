import type {PreviewController} from '../pdf/render';
import {createOrganizerDraft,type OrganizerDraft} from './draft';

export interface PageOrganizer {
  getOrder(): number[];
  dispose(): void;
}
/**
 * Only models the order of PDF pages. Page copying is performed by the tested
 * structural PDF worker, never by DOM screenshots or page rasterization.
 */
export function mountPageOrganizer(
  host: HTMLElement,
  count: number,
  onPreview: (page: number) => void,
  draft:OrganizerDraft=createOrganizerDraft(),
  preview?:PreviewController
): PageOrganizer {
  type Snapshot = number[];
  if(!draft.order.length)draft.order=Array.from({length:count},(_,i)=>i+1);
  let order=draft.order;
  const history=draft.history;
  let future=draft.future;
  let disposed=false,thumbnailGeneration=0;
  let observer:IntersectionObserver|null=null;
  let focusIndex=-1;
  host.classList.add('df2-page-plan');
  host.innerHTML=`<div class="df2-plan-title"><strong>Arrange your pages</strong><span data-plan-total role="status"></span></div>
    <p class="df2-plan-info">Drag page cards to reorder, or use the arrow buttons. Select a thumbnail for a full preview.</p>
    <div class="df2-plan-toolbar"><button type="button" data-plan-undo disabled>↶ Undo</button><button type="button" data-plan-redo disabled>↷ Redo</button><button type="button" data-plan-reset>Reset</button></div>
    <div class="df2-plan-list" data-plan-list aria-label="Page order"></div>`;
  const list=host.querySelector<HTMLElement>('[data-plan-list]')!;
  const total=host.querySelector<HTMLElement>('[data-plan-total]')!;
  const undo=host.querySelector<HTMLButtonElement>('[data-plan-undo]')!;
  const redo=host.querySelector<HTMLButtonElement>('[data-plan-redo]')!;
  const equal=(a:Snapshot,b:Snapshot):boolean=>a.length===b.length&&a.every((x,i)=>x===b[i]);
  const draw=():void=>{
    const generation=++thumbnailGeneration;
    observer?.disconnect();observer=null;
    list.querySelectorAll('canvas').forEach(canvas=>{canvas.width=1;canvas.height=1;});
    list.replaceChildren();
    const segment=document.createDocumentFragment();
    for(const [index,page] of order.entries()){
      const item=document.createElement('div');item.className='df2-plan-row';item.dataset.planIndex=String(index);item.draggable=true;
      const button=document.createElement('button');button.type='button';button.className='df2-plan-page';button.dataset.planView=String(index);
      const label=document.createElement('span');label.textContent='Page '+page;
      const canvas=document.createElement('canvas');canvas.setAttribute('aria-hidden','true');canvas.dataset.sourcePage=String(page);canvas.width=1;canvas.height=1;
      button.append(canvas,label);button.title='Preview original page '+page;
      const tools=document.createElement('div');tools.className='df2-plan-controls';
      const actions=[
        ['up','Move page '+page+' up', '↑',index===0],
        ['down','Move page '+page+' down','↓',index===order.length-1],
        ['copy','Duplicate page '+page,'⧉',false],
        ['remove','Remove page '+page,'×',order.length===1]
      ] as const;
      for(const [action,label,symbol,disabled] of actions){
        const control=document.createElement('button');
        control.type='button';control.dataset.planAction=action;control.ariaLabel=label;
        control.title=label;control.textContent=symbol;control.disabled=disabled;
        tools.append(control);
      }
      item.append(button,tools);segment.append(item);
    }
    list.append(segment);
    if(preview){
      let queue=Promise.resolve();const retained:HTMLCanvasElement[]=[];
      observer=new IntersectionObserver(entries=>{
        for(const entry of entries){
          if(!entry.isIntersecting)continue;
          const canvas=entry.target as HTMLCanvasElement;observer?.unobserve(canvas);
          queue=queue.then(async()=>{
            if(disposed||generation!==thumbnailGeneration||!canvas.isConnected)return;
            try{
              const ok=await preview.renderThumbnail(Number(canvas.dataset.sourcePage),canvas,.26);
              if(!ok||disposed||generation!==thumbnailGeneration)return;
              retained.push(canvas);if(retained.length>24){const old=retained.shift()!;old.width=1;old.height=1;if(old.isConnected)observer?.observe(old);}
            }catch{/* Main preview reports document failures; card remains labelled. */}
          });
        }
      },{rootMargin:'100px'});
      list.querySelectorAll('canvas').forEach(canvas=>observer?.observe(canvas));
    }
    total.textContent=order.length+' output '+(order.length===1?'page':'pages');
    undo.disabled=!history.length;redo.disabled=!future.length;
    if(focusIndex>=0){
      const row=list.querySelector<HTMLElement>(`[data-plan-index="${Math.min(focusIndex,order.length-1)}"]`);
      row?.querySelector<HTMLButtonElement>('[data-plan-action]:not(:disabled)')?.focus({preventScroll:true});
      focusIndex=-1;
    }
  };
  const commit=(next:Snapshot,index:number):void=>{
    if(!next.length||equal(order,next))return;
    history.push(order);if(history.length>75)history.shift();
    future=[];draft.future=future;order=next;draft.order=order;focusIndex=index;draw();host.dispatchEvent(new CustomEvent('df2-draft-change',{bubbles:true}));
  };
  const click=(event:MouseEvent):void=>{
    const target=event.target instanceof Element?event.target.closest<HTMLElement>('button'):null;
    if(!target)return;
    if(target.hasAttribute('data-plan-reset')){commit(Array.from({length:count},(_,i)=>i+1),0);return;}
    if(target.hasAttribute('data-plan-undo')&&history.length){future.push(order);order=history.pop()!;draft.order=order;focusIndex=0;draw();host.dispatchEvent(new CustomEvent('df2-draft-change',{bubbles:true}));return;}
    if(target.hasAttribute('data-plan-redo')&&future.length){history.push(order);order=future.pop()!;draft.order=order;focusIndex=0;draw();host.dispatchEvent(new CustomEvent('df2-draft-change',{bubbles:true}));return;}
    const row=target.closest<HTMLElement>('[data-plan-index]');if(!row)return;
    const index=Number(row.dataset.planIndex);
    if(!Number.isInteger(index)||index<0||index>=order.length)return;
    if(target.hasAttribute('data-plan-view')){onPreview(order[index]!);return;}
    const action=target.dataset.planAction;if(!action)return;
    const next=[...order];const page=next[index]!;
    if(action==='up'&&index>0){[next[index-1],next[index]]=[page,next[index-1]!];commit(next,index-1);}
    if(action==='down'&&index<next.length-1){[next[index],next[index+1]]=[next[index+1]!,page];commit(next,index+1);}
    if(action==='copy'){next.splice(index+1,0,page);commit(next,index+1);}
    if(action==='remove'&&next.length>1){next.splice(index,1);commit(next,Math.min(index,next.length-1));}
  };
  const dragStart=(event:DragEvent):void=>{
    const row=event.target instanceof Element?event.target.closest<HTMLElement>('[data-plan-index]'):null;
    if(!row||!event.dataTransfer)return;event.dataTransfer.setData('text/plain',row.dataset.planIndex!);event.dataTransfer.effectAllowed='move';
  };
  const dragOver=(event:DragEvent):void=>{if(event.target instanceof Element&&event.target.closest('[data-plan-index]')){event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='move';}};
  const drop=(event:DragEvent):void=>{
    const row=event.target instanceof Element?event.target.closest<HTMLElement>('[data-plan-index]'):null;
    if(!row||!event.dataTransfer)return;event.preventDefault();const raw=event.dataTransfer.getData('text/plain');
    if(!/^\d+$/.test(raw))return;const from=Number(raw),to=Number(row.dataset.planIndex);
    if(!Number.isInteger(from)||from<0||from>=order.length||from===to)return;
    const next=[...order],page=next.splice(from,1)[0]!;next.splice(to,0,page);commit(next,to);
  };
  host.addEventListener('click',click);
  list.addEventListener('dragstart',dragStart);list.addEventListener('dragover',dragOver);list.addEventListener('drop',drop);
  draw();
  return { getOrder:()=>[...order], dispose:()=>{disposed=true;++thumbnailGeneration;observer?.disconnect();host.removeEventListener('click',click);list.removeEventListener('dragstart',dragStart);list.removeEventListener('dragover',dragOver);list.removeEventListener('drop',drop);host.querySelectorAll('canvas').forEach(c=>{c.width=1;c.height=1;});host.replaceChildren();}};
}
