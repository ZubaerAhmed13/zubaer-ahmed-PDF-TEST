import type { PreviewController } from '../pdf/render';
import { runWorkerOperation } from '../pdf/workerClient';
import { constrain, displaySize, type EditObject, type EditPlan, type PageFrame } from '../pdf/editModel';
import {createEditorDraft,type EditorDraft} from './draft';
import {loadEditorFont,paintEditorText} from './editorText';
import type {Font} from '@pdf-lib/fontkit';
import {V2NativeEditor} from './nativeEditor';
import type {NativeEditPlan} from '../pdf/nativeModel';

type Kind=EditObject['kind'];
const kinds:[Kind,string][]=[
  ['text','Text'],['rectangle','Shape'],['highlight','Highlight region'],
  ['native-highlight','Editable highlight'],['comment','Sticky note']
];
const uid=():string=>'v2-'+crypto.randomUUID();
const escaping=(s:string):string=>s.replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
export class V2PageEditor {
  private plan:EditPlan;
  private history:EditorDraft['history'];
  private frames:PageFrame[]=[];
  private selected:string|null=null;
  private page=1;
  private drag:{pointerId:number;id:string;startX:number;startY:number;original:EditObject;moved:boolean}|null=null;
  private destroyed=false;
  private overlay:HTMLElement;
  private panel:HTMLElement;
  private status:HTMLElement;
  private onPageRender:()=>void;
  private fileInput:HTMLInputElement|null=null;
  private preserved=0;
  private font:Font|null=null;
  private native:V2NativeEditor|null=null;
  private constructor(private readonly paper:HTMLElement,private readonly canvas:HTMLCanvasElement,
    private readonly host:HTMLElement,private readonly preview:PreviewController,private readonly draft:EditorDraft){
    this.history=draft.history;this.plan=this.history.current;this.selected=draft.selected;
    this.overlay=document.createElement('div');this.overlay.className='df2-editor-overlay';
    this.overlay.setAttribute('role','group');this.overlay.setAttribute('aria-label','Editable additions to this PDF page');this.paper.append(this.overlay);
    this.panel=document.createElement('section');this.panel.className='df2-editor-panel';
    this.panel.setAttribute('aria-label','Edit PDF tools and properties');
    this.status=document.createElement('div');this.status.className='df2-editor-status';
    this.status.setAttribute('role','status');this.status.setAttribute('aria-live','polite');
    this.host.append(this.panel);
    this.onPageRender=()=>this.paint();
    this.canvas.addEventListener('docflow-page-rendered',this.onPageRender);
    this.overlay.addEventListener('pointerdown',this.pointerDown);
    this.overlay.addEventListener('pointermove',this.pointerMove);
    this.overlay.addEventListener('pointerup',this.pointerUp);
    this.overlay.addEventListener('pointercancel',this.pointerCancel);
    this.overlay.addEventListener('keydown',this.keyDown);
    this.panel.addEventListener('click',this.onClick);
    this.panel.addEventListener('change',this.onChange);
  }
  static async mount(paper:HTMLElement,canvas:HTMLCanvasElement,host:HTMLElement,viewer:PreviewController,file:File,draft:EditorDraft=createEditorDraft()):Promise<V2PageEditor>{
    const editor=new V2PageEditor(paper,canvas,host,viewer,draft);
    try{
      const [result,font]=await Promise.all([runWorkerOperation('direct-edit-inspect',
        [{name:file.name,type:file.type||'application/pdf',buffer:await file.arrayBuffer()}],{},()=>{}).result,loadEditorFont()]);
      if(editor.destroyed)throw Error('Editor was closed before inspection completed');
      editor.frames=JSON.parse(String(result.info?.frames??'[]')) as PageFrame[];
      editor.preserved=Number(result.info?.preservedHighlights??0);
      editor.font=font;
      editor.native=new V2NativeEditor(paper,canvas,host,file,draft,(source,preview)=>editor.commitSource(source,preview));
      editor.paintPanel();
      editor.paint();
      return editor;
    }catch(e){editor.dispose();throw e;}
  }
  get currentPlan():EditPlan{return structuredClone(this.plan);}
  get containsText():boolean{return this.plan.objects.some(o=>o.kind==='text');}
  get nativeBusy():boolean{return this.native?.busy??false;}
  get hasPendingSource():boolean{return this.native?.hasPending??false;}
  private commitSource(source:NativeEditPlan,preview:ArrayBuffer):void{
    const candidate=this.history.current;candidate.source=source;
    // Accept the complete plan before changing the plan used by export.
    this.history.commit(candidate);this.plan=this.history.current;this.commit(preview);
  }
  private frame():PageFrame|undefined{return this.frames[this.page-1];}
  show(page:number):void {const next=Math.max(1,Math.min(page,this.frames.length));if(next!==this.page)this.selected=null;this.page=next;this.paint();this.paintPanel();this.native?.show(next);}
  private commit(preview?:ArrayBuffer):void{
    if(this.history.commit(this.plan)){
      this.plan=this.history.current;
      this.status.textContent='Unsaved changes · '+this.plan.objects.length+' additions';
    }
    this.paint();this.paintPanel();
    this.native?.refresh();this.paper.dispatchEvent(new CustomEvent('df2-draft-change',{bubbles:true,detail:{preview}}));
  }
  private colorDefault(kind:Kind):string{ return kind==='highlight'?'#f2d55c':kind==='native-highlight'?'#ffd352':kind==='comment'?'#db8b38':'#5c50c8';}
  private add(kind:Kind,data?:string):void{
    const frame=this.frame();if(!frame)return;
    if(this.plan.objects.length>=1000){this.status.textContent='Maximum 1,000 objects per document.';return;}
    const size=displaySize(frame);
    const width=Math.min(size.width*.46,kind==='comment'?28:220),height=kind==='text'?54:kind==='comment'?28:kind==='image'?120:76;
    const obj:EditObject={
      id:uid(),page:this.page,kind,x:Math.round(size.width*.16),y:Math.round(size.height*.2),
      width:Math.min(width,size.width),height:Math.min(height,size.height),
      size:kind==='text'?18:14,color:this.colorDefault(kind),
      ...(kind==='text'?{text:'Your text'}:{}),
      ...(kind==='comment'?{text:'Add your note'}:{}),
      ...(data?{data}:{})
    };
    Object.assign(obj,constrain(obj,frame,true));
    this.plan.objects.push(obj);this.selected=obj.id;this.commit();
    this.panel.querySelector<HTMLElement>('[name=editorText]')?.focus();
  }
  private selectedObject():EditObject|undefined{return this.plan.objects.find(o=>o.id===this.selected);}
  private relativePoint(event:PointerEvent):{x:number;y:number}|null{
    const frame=this.frame();if(!frame)return null;
    const box=this.overlay.getBoundingClientRect(),size=displaySize(frame);
    if(!box.width||!box.height)return null;
    return {x:(event.clientX-box.left)/box.width*size.width,y:(event.clientY-box.top)/box.height*size.height};
  }
  private pointerDown=(event:PointerEvent):void=>{
    const target=event.target instanceof Element?event.target.closest<HTMLElement>('[data-edit-id]'):null;
    if(!target||event.button!==0)return;
    const obj=this.plan.objects.find(o=>o.id===target.dataset.editId);const p=this.relativePoint(event);
    if(!obj||!p)return;
    this.selected=obj.id;this.drag={pointerId:event.pointerId,id:obj.id,startX:p.x,startY:p.y,original:{...obj},moved:false};
    this.overlay.setPointerCapture(event.pointerId);this.paint();this.paintPanel();
    event.preventDefault();
  };
  private pointerMove=(event:PointerEvent):void=>{
    const drag=this.drag;if(!drag||drag.pointerId!==event.pointerId)return;
    const obj=this.plan.objects.find(o=>o.id===drag.id),p=this.relativePoint(event),frame=this.frame();
    if(!obj||!p||!frame)return;
    const x=p.x-drag.startX,y=p.y-drag.startY;
    if(!drag.moved&&Math.hypot(x,y)<2)return;
    drag.moved=true;
    const rect=constrain({...drag.original,x:drag.original.x+x,y:drag.original.y+y},frame,true);
    Object.assign(obj,rect);this.paint();this.paintProperties();
  };
  private pointerUp=(event:PointerEvent):void=>{
    if(!this.drag||this.drag.pointerId!==event.pointerId)return;
    const moved=this.drag.moved;this.drag=null;
    if(this.overlay.hasPointerCapture(event.pointerId))this.overlay.releasePointerCapture(event.pointerId);
    if(moved)this.commit();
  };
  private pointerCancel=(event:PointerEvent):void=>{
    const drag=this.drag;if(!drag||drag.pointerId!==event.pointerId)return;
    const obj=this.plan.objects.find(o=>o.id===drag.id);
    if(obj)Object.assign(obj,drag.original);
    this.drag=null;this.paint();
  };
  private keyDown=(event:KeyboardEvent):void=>{
    const obj=this.selectedObject(),frame=this.frame();
    if(!obj||!frame||event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement)return;
    if(event.key==='Delete'||event.key==='Backspace'){
      event.preventDefault();this.remove();return;
    }
    const d=event.shiftKey?10:1;
    const movements:Record<string,[number,number]>={ArrowUp:[0,-d],ArrowDown:[0,d],ArrowLeft:[-d,0],ArrowRight:[d,0]};
    const delta=movements[event.key];
    if(!delta)return;
    event.preventDefault();
    Object.assign(obj,constrain({...obj,x:obj.x+delta[0],y:obj.y+delta[1]},frame));
    this.commit();
    this.overlay.querySelector<HTMLElement>('[data-edit-id="'+obj.id+'"]')?.focus();
  };
  private remove():void{
    if(!this.selectedObject())return;
    // Existing source annotations are not made editable by this release.
    this.plan.objects=this.plan.objects.filter(o=>o.id!==this.selected);
    this.selected=null;this.commit();
  }
  private paint():void{
    if(this.destroyed)return;
    const frame=this.frame();
    if(!frame)return;
    const size=displaySize(frame);
    const bounds=this.canvas.getBoundingClientRect();
    const w=bounds.width||this.canvas.width,h=bounds.height||this.canvas.height;
    if(!w||!h)return;
    this.overlay.style.width=w+'px';this.overlay.style.height=h+'px';
    this.overlay.replaceChildren();
    for(const obj of this.plan.objects.filter(o=>o.page===this.page)){
      const el=document.createElement('button');
      el.type='button';el.className='df2-edit-object df2-edit-'+obj.kind;
      el.dataset.editId=obj.id;
      el.setAttribute('aria-label',obj.kind+' on page '+this.page+': '+(obj.text??'visual object'));
      el.setAttribute('aria-pressed',String(this.selected===obj.id));
      el.style.left=(obj.x/size.width*100)+'%';el.style.top=(obj.y/size.height*100)+'%';
      el.style.width=(obj.width/size.width*100)+'%';el.style.height=(obj.height/size.height*100)+'%';
      el.style.setProperty('--obj-ink',obj.color);
      if(obj.kind==='image'||obj.kind==='signature'){
        const image=document.createElement('img');image.src=obj.data??'';image.alt='Added image';
        image.draggable=false;el.append(image);
      } else if(obj.kind==='text'&&this.font){
        el.style.fontFamily='DocFlowEditor';el.style.fontSize=(obj.size*w/size.width)+'px';
        paintEditorText(el,obj,this.font);
      }
      else if(obj.kind==='comment')el.textContent='▣';
      this.overlay.append(el);
    }
  }
  private paintPanel():void{
    if(this.destroyed)return;
    const tools=kinds.map(([kind,label])=>`<button type="button" data-editor-add="${kind}">${escaping(label)}</button>`).join('');
    const list=this.plan.objects.filter(o=>o.page===this.page).map(o=>
      `<button type="button" data-editor-select="${o.id}" aria-pressed="${o.id===this.selected}">${escaping(o.kind.replace('-',' '))} · ${escaping((o.text??'Object').slice(0,28))}</button>`).join('');
    this.panel.innerHTML=`<div class="df2-editor-heading"><strong>Add content and annotations</strong><p>Use Existing content to replace supported source text and images.</p></div>
      <div class="df2-editor-add">${tools}<label class="df2-editor-image">Add image<input type="file" data-editor-image accept="image/png,image/jpeg"></label></div>
      <div class="df2-editor-history"><button data-editor-undo ${this.history.canUndo?'':'disabled'}>↶ Undo</button>
      <button data-editor-redo ${this.history.canRedo?'':'disabled'}>↷ Redo</button></div>
      <div class="df2-editor-objects"><strong>Page ${this.page} objects</strong>${list||'<p>Choose a tool above to add your first object.</p>'}</div>
      <div class="df2-editor-properties" data-editor-properties></div>
      <div class="df2-editor-note">Drag additions to move, or use the X/Y fields and keyboard arrow keys for precision.</div>`;
    this.panel.append(this.status);
    this.fileInput=this.panel.querySelector<HTMLInputElement>('[data-editor-image]');
    this.paintProperties();
    if(this.preserved>0)this.status.textContent=this.preserved+' pre-existing highlights are preserved.';
    if(this.overlay.querySelector('[data-text-overflow=true]'))this.status.textContent='Text exceeds its box or uses unsupported characters. Enlarge the box, reduce its size or change the text before exporting.';
  }
  private paintProperties():void{
    const host=this.panel.querySelector<HTMLElement>('[data-editor-properties]');if(!host)return;
    const obj=this.selectedObject();
    if(!obj){host.replaceChildren();return;}
    const text= obj.kind==='text'||obj.kind==='comment';
    const input=(name:string,label:string,value:number)=>`<label>${label}<input name="${name}" type="number" step="0.5" min="0" value="${value}"></label>`;
    host.innerHTML=`<strong>Object properties</strong>
      ${text?`<label>Content<textarea name="editorText" rows="3">${escaping(obj.text??'')}</textarea></label>`:''}
      <div class="df2-editor-grid">${input('x','X (points)',obj.x)}${input('y','Y (points)',obj.y)}
      ${input('width','Width',obj.width)}${input('height','Height',obj.height)}
      ${text?input('size','Font size',obj.size):''}
      <label>Colour<input type="color" name="color" value="${obj.color}"></label></div>
      <button class="df2-editor-remove" type="button" data-editor-remove>Remove selected object</button>`;
  }
  private onClick=(event:MouseEvent):void=>{
    const node=event.target instanceof Element?event.target.closest<HTMLElement>('button'):null;
    if(!node)return;
    const kind=node.dataset.editorAdd as Kind|undefined;
    if(kind){this.add(kind);return;}
    if(node.hasAttribute('data-editor-undo')){this.plan=this.history.undo();this.selected=null;this.paint();this.paintPanel();this.native?.refresh();this.paper.dispatchEvent(new CustomEvent('df2-draft-change',{bubbles:true}));return;}
    if(node.hasAttribute('data-editor-redo')){this.plan=this.history.redo();this.selected=null;this.paint();this.paintPanel();this.native?.refresh();this.paper.dispatchEvent(new CustomEvent('df2-draft-change',{bubbles:true}));return;}
    if(node.hasAttribute('data-editor-remove')){this.remove();return;}
    if(node.dataset.editorSelect){this.selected=node.dataset.editorSelect;this.paint();this.paintPanel();return;}
  };
  private onChange=(event:Event):void=>{
    const target=event.target;
    if(target instanceof HTMLInputElement&&target.hasAttribute('data-editor-image')){
      const file=target.files?.[0];target.value='';
      if(!file)return;
      if(!['image/png','image/jpeg'].includes(file.type)||file.size>10*1024*1024){
        this.status.textContent='Choose a PNG or JPEG smaller than 10 MB.';return;
      }
      const reader=new FileReader();
      reader.onload=()=>{if(!this.destroyed&&typeof reader.result==='string')this.add('image',reader.result);};
      reader.onerror=()=>{this.status.textContent='Unable to read image.';};
      reader.readAsDataURL(file);return;
    }
    if(!(target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement))return;
    if(this.applyProperty(target))this.commit();
  };
  private applyProperty(target:HTMLInputElement|HTMLTextAreaElement):boolean{
    if(!this.panel.contains(target)||!target.name)return false;
    const obj=this.selectedObject(),frame=this.frame();if(!obj||!frame)return false;
    const key=target.name;
    if(key==='editorText')obj.text=target.value;
    else if(key==='color')obj.color=target.value;
    else if(['x','y','width','height','size'].includes(key)){
      const n=Number(target.value);
      if(!Number.isFinite(n))return false;
      if(key==='size')obj.size=Math.max(7,Math.min(60,n));
      else Object.assign(obj,constrain({...obj,[key]:n},frame));
    }else return false;
    return true;
  }
  dispose():void{
    if(this.destroyed)return;
    // Hash navigation can remove a focused control without firing change.
    // Commit pending property values before the view releases the shared draft.
    const before=JSON.stringify(this.plan);
    this.panel.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('[data-editor-properties] input,[data-editor-properties] textarea').forEach(input=>this.applyProperty(input));
    if(JSON.stringify(this.plan)!==before)this.commit();
    this.draft.selected=this.selected;this.destroyed=true;
    this.native?.dispose();this.native=null;
    this.canvas.removeEventListener('docflow-page-rendered',this.onPageRender);
    this.overlay.removeEventListener('pointerdown',this.pointerDown);
    this.overlay.removeEventListener('pointermove',this.pointerMove);
    this.overlay.removeEventListener('pointerup',this.pointerUp);
    this.overlay.removeEventListener('pointercancel',this.pointerCancel);
    this.overlay.removeEventListener('keydown',this.keyDown);
    this.panel.removeEventListener('click',this.onClick);
    this.panel.removeEventListener('change',this.onChange);
    this.overlay.remove();this.panel.remove();
  }
}
