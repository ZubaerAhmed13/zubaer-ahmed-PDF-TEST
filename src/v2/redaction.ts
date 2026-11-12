import {rectangleFromDrag,validateRedactions,type RedactionRect} from '../pdf/secureRasterRedaction';
import {renderedPage} from '../pdf/render';
export type RedactionDraft={marks:RedactionRect[];past:RedactionRect[][];future:RedactionRect[][];drawing:boolean};
export const createRedactionDraft=():RedactionDraft=>({marks:[],past:[],future:[],drawing:true});
const copy=(marks:readonly RedactionRect[])=>marks.map(mark=>({...mark}));

export class V2Redaction {
  private overlay=document.createElement('div');
  private panel=document.createElement('section');
  private page=1;
  private drag:{x:number;y:number;pointer:number;page:number}|null=null;
  private disposed=false;
  constructor(private canvas:HTMLCanvasElement,paper:HTMLElement,host:HTMLElement,private pages:number,private draft:RedactionDraft,private changed:()=>void,private jump:(page:number)=>void,private busy:()=>boolean){
    this.overlay.className='df2-redact-layer';this.overlay.dataset.redactLayer='';this.overlay.setAttribute('aria-hidden','true');paper.append(this.overlay);
    this.panel.className='df2-redact-panel';this.panel.setAttribute('aria-label','Redaction areas');
    this.panel.innerHTML=`<h2>Redaction areas</h2><p>Drag across the page or add an area using percentages. Turn drawing off to pan the document.</p><button type="button" data-redact-drawing>Drawing on</button><div class="df2-redact-coordinates">${[['redactX','Left (%)','10'],['redactY','Top (%)','20'],['redactWidth','Width (%)','60'],['redactHeight','Height (%)','15']].map(([name,title,value])=>`<label>${title}<input type="number" name="${name}" value="${value}" min="0" max="100" step="0.5"></label>`).join('')}</div><button type="button" data-redact-add>Add area</button><div class="df2-redact-actions"><button type="button" data-redact-undo aria-label="Undo area change">Undo</button><button type="button" data-redact-redo aria-label="Redo area change">Redo</button></div><p data-redact-count role="status"></p><p data-redact-error role="status" aria-live="polite"></p><div data-redact-list></div>`;
    host.append(this.panel);this.panel.addEventListener('click',this.click);
    this.overlay.addEventListener('pointerdown',this.down);this.overlay.addEventListener('pointermove',this.move);this.overlay.addEventListener('pointerup',this.up);this.overlay.addEventListener('pointercancel',this.cancelDrag);
    this.canvas.addEventListener('docflow-page-rendered',this.rendered);this.rendered();
  }
  clearPage():void{this.cancelDrag();this.overlay.hidden=true;this.panel.inert=true;}
  get hasPending():boolean{return this.drag!==null;}
  private rendered=():void=>{
    const detail=renderedPage(this.canvas);if(!detail||this.disposed)return;
    this.cancelDrag();this.page=detail.pageNumber;
    const bounds=this.canvas.getBoundingClientRect(),origin=this.overlay.parentElement!.getBoundingClientRect();
    // Paper has minimum dimensions for layout; masks must follow the canvas.
    Object.assign(this.overlay.style,{left:bounds.x-origin.x+'px',top:bounds.y-origin.y+'px',right:'auto',bottom:'auto',width:bounds.width+'px',height:bounds.height+'px'});
    this.overlay.hidden=false;this.panel.inert=false;this.paint();
  };
  private cancelDrag=():void=>{if(this.drag&&this.overlay.hasPointerCapture(this.drag.pointer))this.overlay.releasePointerCapture(this.drag.pointer);this.drag=null;this.paintMasks();};
  private point(event:PointerEvent){const box=this.canvas.getBoundingClientRect();return{x:(event.clientX-box.x)/box.width,y:(event.clientY-box.y)/box.height};}
  private down=(event:PointerEvent):void=>{if(this.drag||this.busy()||!this.draft.drawing||event.button!==0)return;event.preventDefault();this.drag={...this.point(event),pointer:event.pointerId,page:this.page};this.overlay.setPointerCapture(event.pointerId);};
  private move=(event:PointerEvent):void=>{if(!this.drag||this.drag.pointer!==event.pointerId)return;const p=this.point(event);this.paintMasks(rectangleFromDrag(this.drag.page,this.drag.x,this.drag.y,p.x,p.y));};
  private up=(event:PointerEvent):void=>{if(!this.drag||this.drag.pointer!==event.pointerId)return;const p=this.point(event),area=rectangleFromDrag(this.drag.page,this.drag.x,this.drag.y,p.x,p.y);this.cancelDrag();if(this.busy())return;if(area.width>=.005&&area.height>=.005)this.commit([...this.draft.marks,area]);else this.paintMasks();};
  private error(message:string):void{this.panel.querySelector<HTMLElement>('[data-redact-error]')!.textContent=message;}
  private commit(marks:RedactionRect[]):void{
    try{validateRedactions(marks,this.pages);}catch(error){if(marks.length){this.error(error instanceof Error?error.message:'Invalid redaction area.');this.paintMasks();return;}}
    this.draft.past.push(copy(this.draft.marks));if(this.draft.past.length>50)this.draft.past.shift();this.draft.marks=copy(marks);this.draft.future=[];this.error('');this.changed();this.paint();
  }
  private click=(event:Event):void=>{
    const target=event.target instanceof Element?event.target.closest<HTMLElement>('button'):null;if(!target||this.busy()||this.panel.inert)return;
    if(target.hasAttribute('data-redact-add')){
      const number=(name:string)=>this.panel.querySelector<HTMLInputElement>(`[name=${name}]`)!.valueAsNumber/100;
      this.commit([...this.draft.marks,{page:this.page,x:number('redactX'),y:number('redactY'),width:number('redactWidth'),height:number('redactHeight')}]);
    }else if(target.hasAttribute('data-redact-drawing')){this.draft.drawing=!this.draft.drawing;this.cancelDrag();this.paint();}
    else if(target.hasAttribute('data-redact-undo')){const prior=this.draft.past.pop();if(prior){this.draft.future.push(copy(this.draft.marks));this.draft.marks=prior;this.changed();this.paint();}}
    else if(target.hasAttribute('data-redact-redo')){const next=this.draft.future.pop();if(next){this.draft.past.push(copy(this.draft.marks));this.draft.marks=next;this.changed();this.paint();}}
    else if(target.dataset.redactJump!==undefined){const mark=this.draft.marks[Number(target.dataset.redactJump)];if(mark)this.jump(mark.page);}
    else if(target.dataset.redactRemove!==undefined){const index=Number(target.dataset.redactRemove);this.commit(this.draft.marks.filter((_,i)=>i!==index));this.panel.querySelector<HTMLElement>(`[data-redact-remove="${Math.min(index,this.draft.marks.length-1)}"]`)?.focus();if(!this.draft.marks.length)this.panel.querySelector<HTMLElement>('[data-redact-undo]')?.focus();}
  };
  private paintMasks(draft?:RedactionRect):void{
    this.overlay.replaceChildren();this.overlay.style.pointerEvents=this.draft.drawing?'auto':'none';
    for(const mark of [...this.draft.marks.filter(mark=>mark.page===this.page),...(draft?[draft]:[])]){const mask=document.createElement('span');mask.dataset.redactMask='';Object.assign(mask.style,{left:mark.x*100+'%',top:mark.y*100+'%',width:mark.width*100+'%',height:mark.height*100+'%'});this.overlay.append(mask);}
  }
  private paint():void{
    const active=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const focus=active?.hasAttribute('data-redact-jump')?`[data-redact-jump="${active.dataset.redactJump}"]`:active?.hasAttribute('data-redact-remove')?`[data-redact-remove="${active.dataset.redactRemove}"]`:null;
    this.paintMasks();this.panel.querySelector<HTMLElement>('[data-redact-count]')!.textContent=`${this.draft.marks.length} ${this.draft.marks.length===1?'area':'areas'} · ${this.draft.marks.filter(mark=>mark.page===this.page).length} on page ${this.page}`;
    const drawing=this.panel.querySelector<HTMLButtonElement>('[data-redact-drawing]')!;drawing.textContent=this.draft.drawing?'Drawing on':'Drawing off';drawing.setAttribute('aria-pressed',String(this.draft.drawing));
    this.panel.querySelector<HTMLButtonElement>('[data-redact-undo]')!.disabled=!this.draft.past.length;this.panel.querySelector<HTMLButtonElement>('[data-redact-redo]')!.disabled=!this.draft.future.length;
    const list=this.panel.querySelector<HTMLElement>('[data-redact-list]')!;list.replaceChildren();this.draft.marks.forEach((mark,i)=>{const row=document.createElement('div'),jump=document.createElement('button'),remove=document.createElement('button');jump.type=remove.type='button';jump.dataset.redactJump=String(i);jump.textContent=`Area ${i+1} · page ${mark.page}`;remove.dataset.redactRemove=String(i);remove.textContent=`Remove area ${i+1}`;row.append(jump,remove);list.append(row);});
    if(focus)this.panel.querySelector<HTMLElement>(focus)?.focus({preventScroll:true});
  }
  dispose():void{if(this.disposed)return;this.disposed=true;this.cancelDrag();this.canvas.removeEventListener('docflow-page-rendered',this.rendered);this.panel.removeEventListener('click',this.click);this.overlay.removeEventListener('pointerdown',this.down);this.overlay.removeEventListener('pointermove',this.move);this.overlay.removeEventListener('pointerup',this.up);this.overlay.removeEventListener('pointercancel',this.cancelDrag);this.overlay.remove();this.panel.remove();}
}
