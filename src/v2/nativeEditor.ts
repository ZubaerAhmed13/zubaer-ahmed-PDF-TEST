import {runWorkerOperation,type RunningOperation} from '../pdf/workerClient';
import {displaySize} from '../pdf/editModel';
import type {NativeEditPlan,NativeInspection,NativeObject} from '../pdf/nativeModel';
import type {EditorDraft} from './draft';

const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
type SourceFocus={area:'panel'|'overlay';selector:string;start?:number;end?:number;direction?:'forward'|'backward'|'none'};
/** DOM boxes select immutable source IDs; the canvas alone shows edited content. */
export class V2NativeEditor {
  private panel=document.createElement('section');
  private overlay=document.createElement('div');
  private inspections=new Map<number,NativeInspection>();
  private page=1;
  private generation=0;
  private destroyed=false;
  private operation:RunningOperation|null=null;
  private applying=false;
  private status='';
  private validationFocus:SourceFocus|null=null;
  constructor(private paper:HTMLElement,private canvas:HTMLCanvasElement,host:HTMLElement,private file:File,private draft:EditorDraft,private commit:(plan:NativeEditPlan,preview:ArrayBuffer)=>void){
    this.panel.className='df2-native-panel';this.panel.setAttribute('aria-label','Existing PDF content');this.panel.tabIndex=-1;host.append(this.panel);
    this.overlay.className='df2-native-overlay';this.overlay.setAttribute('role','group');this.overlay.setAttribute('aria-label','Existing PDF text and images');paper.append(this.overlay);
    this.panel.addEventListener('click',this.click);this.panel.addEventListener('input',this.input);this.panel.addEventListener('change',this.change);
    this.overlay.addEventListener('click',this.click);this.canvas.addEventListener('docflow-page-rendered',this.rendered);this.paint();
  }
  private rendered=()=>this.paintOverlay();
  get busy():boolean{return this.applying;}
  get hasPending():boolean{return Object.keys(this.draft.native.pending).length>0;}
  show(page:number):void{
    if(this.page!==page){++this.generation;this.operation?.cancel();this.operation=null;this.applying=false;this.validationFocus=null;this.page=page;this.status='';this.paint();}
    if(this.draft.native.enabled&&!this.inspections.has(page))void this.inspect();else this.paintOverlay();
  }
  refresh():void{this.paint();}
  private async inspect():Promise<void>{
    const generation=++this.generation,page=this.page;this.operation?.cancel();this.status='Inspecting existing content…';this.paint();
    try{
      const buffer=await this.file.arrayBuffer();if(this.destroyed||generation!==this.generation)return;
      this.operation=runWorkerOperation('native-edit-inspect',[{name:this.file.name,type:'application/pdf',buffer}],{page},()=>{});
      const result=await this.operation.result;if(this.destroyed||generation!==this.generation)return;
      this.inspections.set(page,JSON.parse(String(result.info?.inspection)) as NativeInspection);this.status='Select existing text or an image.';this.paint();
    }catch(e){if(!this.destroyed&&generation===this.generation){this.status=e instanceof Error?e.message:'Source inspection failed.';this.paint();}}
    finally{if(generation===this.generation)this.operation=null;}
  }
  private item():NativeObject|undefined{return this.inspections.get(this.page)?.objects.find(o=>o.id===this.draft.native.selected);}
  private focusSnapshot(area:'panel'|'overlay'):SourceFocus|null{
    const root=area==='panel'?this.panel:this.overlay,active=document.activeElement;
    if(!(active instanceof HTMLElement)||active===root||!root.contains(active))return null;
    const attribute=['name','data-source-select','data-source-toggle','data-source-apply','data-source-remove','data-source-discard','data-source-image'].find(key=>active.hasAttribute(key));
    if(!attribute)return null;
    const focus:SourceFocus={area,selector:`[${attribute}="${CSS.escape(active.getAttribute(attribute)!)}"]`};
    if(active instanceof HTMLInputElement&&active.selectionStart!==null){focus.start=active.selectionStart;focus.end=active.selectionEnd??focus.start;focus.direction=active.selectionDirection??'none';}
    return focus;
  }
  private restoreFocus(focus:SourceFocus|null):void{
    if(!focus)return;
    const root=focus.area==='panel'?this.panel:this.overlay;
    let target=root.querySelector<HTMLElement>(focus.selector);
    if(!target||target.closest('[hidden]'))target=this.panel.querySelector<HTMLElement>(`[data-source-select="${CSS.escape(this.draft.native.selected??'')}"]`)??this.panel.querySelector('[data-source-toggle]');
    if(!target)return;
    if(target.matches(':disabled')){
      if(this.applying){this.validationFocus=focus;this.panel.focus({preventScroll:true});}
      return;
    }
    target.focus({preventScroll:true});
    if(target instanceof HTMLInputElement&&focus.start!==undefined)target.setSelectionRange(focus.start,focus.end??focus.start,focus.direction);
  }
  private paint():void{
    if(this.destroyed)return;
    const focus=!this.applying&&document.activeElement===this.panel&&this.validationFocus?this.validationFocus:this.focusSnapshot('panel');
    this.panel.setAttribute('aria-busy',String(this.applying));
    const {enabled,pending}=this.draft.native,inspection=this.inspections.get(this.page),item=this.item(),source=this.draft.history.current.source,change=source?.edits.find(e=>e.id===item?.id);
    const values=item?pending[item.id]??(change?.kind==='text'?change:{text:item.text??'',font:'original' as const}):null;
    this.panel.innerHTML=`<h2>Existing content</h2><button type="button" data-source-toggle aria-pressed="${enabled}">${enabled?'Hide source selection':'Select existing content'}</button>
      ${enabled?`<p>Change actual PDF text or images. Font changes affect layout; review the page before downloading. Removal is not secure redaction.</p>
      <div class="df2-source-list" aria-label="Source objects on page ${this.page}">${inspection?.objects.map(o=>`<button type="button" data-source-select="${o.id}" aria-pressed="${item?.id===o.id}">${escape(o.kind==='text'?o.text??'Text':o.kind==='image'?'Image':'Grouped or vector content')}${source?.edits.some(e=>e.id===o.id)?' · changed':''}</button>`).join('')??''}</div>
      ${item?`<div class="df2-source-properties"><strong>${escape(item.font??item.kind)}</strong>${!item.editable?`<p>${escape(item.reason??'Unsupported content.')}</p>`:
        `${change?.kind==='remove'?'<p>Removed from the result. Undo to restore.</p>':item.kind==='text'?`<label>Existing text<input name="nativeText" value="${escape(values!.text)}" maxlength="10000" ${this.applying?'disabled':''}></label><label>Source font<select name="nativeFont" ${this.applying?'disabled':''}><option value="original" ${values!.font==='original'?'selected':''}>Keep original font</option><option value="docflow" ${values!.font==='docflow'?'selected':''}>Use DocFlow Sans (changes appearance)</option></select></label><button type="button" data-source-apply ${this.applying?'disabled':''}>Apply source text</button>`:`<label>Replace this image<input type="file" data-source-image accept="image/png,image/jpeg" ${this.applying?'disabled':''}></label>`}
        <button type="button" data-source-remove ${this.applying||change?.kind==='remove'?'disabled':''}>Remove source object</button>`}</div>`:''}`:''}
      <p data-source-status role="status" aria-live="polite">${escape(this.status)}</p>${this.hasPending?'<button type="button" data-source-discard>Discard unapplied source changes</button>':''}`;
    this.paintOverlay();
    this.restoreFocus(focus);if(!this.applying)this.validationFocus=null;
  }
  private paintOverlay():void{
    const focus=this.focusSnapshot('overlay');
    this.overlay.hidden=!this.draft.native.enabled;this.overlay.replaceChildren();
    const inspection=this.inspections.get(this.page);if(!inspection){this.restoreFocus(focus);return;}
    const size=displaySize(inspection.frame),bounds=this.canvas.getBoundingClientRect();
    const origin=this.paper.getBoundingClientRect();
    Object.assign(this.overlay.style,{left:bounds.x-origin.x+'px',top:bounds.y-origin.y+'px',right:'auto',bottom:'auto',width:bounds.width+'px',height:bounds.height+'px'});
    for(const object of inspection.objects){
      if(object.kind==='other'||this.draft.history.current.source?.edits.some(e=>e.id===object.id&&e.kind==='remove'))continue;
      const button=document.createElement('button');button.type='button';button.dataset.sourceSelect=object.id;
      button.setAttribute('aria-label',`Select existing ${object.kind}: ${object.text??'image'}`);button.setAttribute('aria-pressed',String(object.id===this.draft.native.selected));
      Object.assign(button.style,{left:object.rect.x/size.width*100+'%',top:object.rect.y/size.height*100+'%',width:Math.max(1,object.rect.width)/size.width*100+'%',height:Math.max(1,object.rect.height)/size.height*100+'%'});
      this.overlay.append(button);
    }
    this.restoreFocus(focus);
  }
  private click=(event:Event):void=>{
    const button=event.target instanceof Element?event.target.closest<HTMLElement>('button'):null;if(!button||this.applying)return;
    if(button.hasAttribute('data-source-toggle')){this.draft.native.enabled=!this.draft.native.enabled;this.paint();this.show(this.page);}
    if(button.hasAttribute('data-source-discard')){this.draft.native.pending={};this.status='Unapplied source changes discarded.';this.paint();}
    if(button.dataset.sourceSelect){this.draft.native.selected=button.dataset.sourceSelect;this.status='';this.paint();}
    if(button.hasAttribute('data-source-apply')){
      const item=this.item(),text=this.panel.querySelector<HTMLInputElement>('[name=nativeText]')?.value,font=this.panel.querySelector<HTMLSelectElement>('[name=nativeFont]')?.value;
      if(item&&text!==undefined)void this.apply({id:item.id,kind:'text',text,font:font==='docflow'?'docflow':'original'});
    }
    if(button.hasAttribute('data-source-remove')&&this.item())void this.apply({id:this.item()!.id,kind:'remove'});
  };
  private input=():void=>{
    const item=this.item(),text=this.panel.querySelector<HTMLInputElement>('[name=nativeText]'),font=this.panel.querySelector<HTMLSelectElement>('[name=nativeFont]');
    if(item&&text&&font){
      const value={text:text.value,font:font.value==='docflow'?'docflow' as const:'original' as const},edit=this.draft.history.current.source?.edits.find(e=>e.id===item.id);
      const base=edit?.kind==='text'?edit:{text:item.text??'',font:'original'};
      if(value.text===base.text&&value.font===base.font)delete this.draft.native.pending[item.id];else this.draft.native.pending[item.id]=value;
      const discard=this.panel.querySelector('[data-source-discard]');if(!this.hasPending)discard?.remove();
      else if(!discard){const button=document.createElement('button');button.type='button';button.dataset.sourceDiscard='';button.textContent='Discard unapplied source changes';this.panel.append(button);}
    }
  };
  private change=(event:Event):void=>{
    this.input();const input=event.target;
    if(!(input instanceof HTMLInputElement)||!input.hasAttribute('data-source-image'))return;
    const file=input.files?.[0],item=this.item();input.value='';if(!file||!item)return;
    if(!['image/png','image/jpeg'].includes(file.type)||file.size>10*1024*1024){this.status='Choose a PNG or JPEG up to 10 MB.';this.paint();return;}
    const reader=new FileReader();reader.onload=()=>{if(!this.destroyed&&typeof reader.result==='string')void this.apply({id:item.id,kind:'image',data:reader.result});};reader.onerror=()=>{this.status='The replacement image could not be read.';this.paint();};reader.readAsDataURL(file);
  };
  private async apply(edit:NativeEditPlan['edits'][number]):Promise<void>{
    const inspection=this.inspections.get(this.page);if(this.applying||!inspection)return;
    const snapshot=JSON.stringify(this.draft.history.current),previous=this.draft.history.current.source;
    const plan:NativeEditPlan={fingerprint:inspection.fingerprint,edits:[...(previous?.edits??[]).filter(e=>e.id!==edit.id),edit]};
    this.applying=true;this.status='Validating saved source changes…';this.paint();const generation=++this.generation;this.operation?.cancel();
    try{
      const buffer=await this.file.arrayBuffer();if(this.destroyed||generation!==this.generation)return;
      this.operation=runWorkerOperation('native-edit-preview',[{name:this.file.name,type:'application/pdf',buffer}],{source:plan},()=>{});
      const result=await this.operation.result;if(this.destroyed||generation!==this.generation)return;
      if(snapshot!==JSON.stringify(this.draft.history.current))throw Error('The edit history changed while validating. Apply your source change again.');
      this.commit(plan,result.outputs[0]!.buffer);delete this.draft.native.pending[edit.id];this.status='Source change applied. Review the updated page.';
    }catch(e){if(!this.destroyed&&generation===this.generation)this.status=e instanceof Error?e.message:'The source change could not be applied.';}
    finally{if(!this.destroyed&&generation===this.generation){this.operation=null;this.applying=false;this.paint();}}
  }
  dispose():void{if(this.destroyed)return;this.input();this.destroyed=true;++this.generation;this.operation?.cancel();this.canvas.removeEventListener('docflow-page-rendered',this.rendered);this.panel.remove();this.overlay.remove();}
}
