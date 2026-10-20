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
  onPreview: (page: number) => void
): PageOrganizer {
  type Snapshot = number[];
  let order=Array.from({length:count},(_,i)=>i+1);
  const history: Snapshot[]=[];
  let future: Snapshot[]=[];
  let focusIndex=-1;
  host.classList.add('df2-page-plan');
  host.innerHTML=`<div class="df2-plan-title"><strong>Arrange your pages</strong><span data-plan-total role="status"></span></div>
    <p class="df2-plan-info">Use the arrows to move a page, duplicate to copy it, or remove it. Your source document is never changed.</p>
    <div class="df2-plan-toolbar"><button type="button" data-plan-undo disabled>↶ Undo</button><button type="button" data-plan-redo disabled>↷ Redo</button><button type="button" data-plan-reset>Reset</button></div>
    <div class="df2-plan-list" data-plan-list aria-label="Page order"></div>`;
  const list=host.querySelector<HTMLElement>('[data-plan-list]')!;
  const total=host.querySelector<HTMLElement>('[data-plan-total]')!;
  const undo=host.querySelector<HTMLButtonElement>('[data-plan-undo]')!;
  const redo=host.querySelector<HTMLButtonElement>('[data-plan-redo]')!;
  const equal=(a:Snapshot,b:Snapshot):boolean=>a.length===b.length&&a.every((x,i)=>x===b[i]);
  const draw=():void=>{
    list.replaceChildren();
    const segment=document.createDocumentFragment();
    for(const [index,page] of order.entries()){
      const item=document.createElement('div');item.className='df2-plan-row';item.dataset.planIndex=String(index);
      const button=document.createElement('button');button.type='button';button.className='df2-plan-page';button.dataset.planView=String(index);
      button.textContent='Page '+page;button.title='Preview original page '+page;
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
    future=[];order=next;focusIndex=index;draw();
  };
  const click=(event:MouseEvent):void=>{
    const target=event.target instanceof Element?event.target.closest<HTMLElement>('button'):null;
    if(!target)return;
    if(target.hasAttribute('data-plan-reset')){commit(Array.from({length:count},(_,i)=>i+1),0);return;}
    if(target.hasAttribute('data-plan-undo')&&history.length){future.push(order);order=history.pop()!;focusIndex=0;draw();return;}
    if(target.hasAttribute('data-plan-redo')&&future.length){history.push(order);order=future.pop()!;focusIndex=0;draw();return;}
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
  host.addEventListener('click',click);
  draw();
  return { getOrder:()=>[...order], dispose:()=>{host.removeEventListener('click',click);host.replaceChildren();}};
}
