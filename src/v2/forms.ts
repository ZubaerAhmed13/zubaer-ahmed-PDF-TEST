import {normalizeEditableFields,formChoiceOptions,type InspectedFormField} from '../pdf/formFields';
import {runWorkerOperation,type RunningOperation} from '../pdf/workerClient';
import {renderedPage} from '../pdf/render';
type Value=string|boolean|string[];
type Control=HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement;
type Binding={field:InspectedFormField;choice?:string;overlay:boolean};
export type FormDraft={values:Map<string,Value>;modified:Set<string>;initialized:boolean};
export const createFormDraft=():FormDraft=>({values:new Map(),modified:new Set(),initialized:false});
const supported=new Set(['text','checkbox','radio','dropdown','option-list']);
const empty=(value:Value|undefined)=>value===undefined||value===''||value===false||(Array.isArray(value)&&!value.length);
const original=(field:InspectedFormField):Value=>field.type==='checkbox'?field.value==='true':field.multiSelect?[...(field.selected??[])]:field.value;
export class V2FormFiller{
  private fields:InspectedFormField[]=[];
  private bindings=new Map<Control,Binding>();
  private overlay=document.createElement('div');
  private status=document.createElement('p');
  private operation:RunningOperation|null=null;
  private disposed=false;
  private ready=false;
  constructor(private host:HTMLElement,private canvas:HTMLCanvasElement,private paper:HTMLElement,private draft:FormDraft,private changed:()=>void,private jump:(page:number)=>Promise<void>,private reveal:()=>void){
    host.dataset.formFields='';host.className='df2-form-fields';this.status.setAttribute('role','status');this.status.setAttribute('aria-live','polite');this.status.textContent='Inspecting PDF form fields…';host.replaceChildren(this.status);
    this.overlay.className='df2-form-overlay';this.overlay.setAttribute('role','group');this.overlay.setAttribute('aria-label','PDF form controls on this page');paper.append(this.overlay);canvas.addEventListener('docflow-page-rendered',this.rendered);
  }
  async load(file:File):Promise<void>{
    try{
      const buffer=await file.arrayBuffer();if(this.disposed)return;
      this.operation=runWorkerOperation('forms-inspect',[{name:file.name,type:'application/pdf',buffer}],{},()=>{});
      const result=await this.operation.result;if(this.disposed)return;
      this.fields=normalizeEditableFields(JSON.parse(String(result.info?.fields)));
      if(!this.draft.initialized){for(const field of this.fields){if(supported.has(field.type))this.draft.values.set(field.name,original(field));}this.draft.initialized=true;}
      this.ready=true;this.paintList();this.paintOverlay();
    }catch(error){if(!this.disposed){this.status.textContent=error instanceof Error?error.message:'Form inspection failed.';this.ready=false;this.clearPage();}}
    finally{this.operation=null;}
  }
  private control(field:InspectedFormField,overlay:boolean,label:string,choice?:string):Control{
    let input:Control;
    const textInput=field.type==='text'||(field.type==='dropdown'&&field.editable);
    if(textInput)input=document.createElement(field.multiline?'textarea':'input');
    else if(field.type==='checkbox'||(field.type==='radio'&&overlay)){input=document.createElement('input');input.type=field.type;}
    else {input=document.createElement('select');input.multiple=field.multiSelect===true;if(input.multiple)input.size=Math.min(5,Math.max(2,field.choices?.length??2));else input.append(new Option('Select an option',''));for(const {label,value} of formChoiceOptions(field))input.append(new Option(label,value));}
    if(input instanceof HTMLInputElement&&textInput){input.type='text';if(field.editable){const list=document.createElement('datalist');list.id='df2-form-options-'+crypto.randomUUID();for(const choice of field.choices??[])list.append(new Option(choice,choice));input.setAttribute('list',list.id);(overlay?this.overlay:this.host).append(list);}}
    if(input instanceof HTMLInputElement||input instanceof HTMLTextAreaElement)input.autocomplete='off';
    input.setAttribute('aria-label',label);input.required=field.required===true;input.disabled=field.readOnly===true;input.dataset.formField=field.name;
    if(input instanceof HTMLInputElement&&input.type==='radio')input.name='df2-form-radio-'+this.fields.indexOf(field);
    const binding={field,choice,overlay};this.bindings.set(input,binding);this.sync(input,binding);
    const change=()=>{if(this.disposed||input.disabled)return;let value:Value=input.value;if(field.type==='dropdown'&&field.editable)value=formChoiceOptions(field).find(choice=>choice.label===input.value)?.value??input.value;if(input instanceof HTMLInputElement){if(input.type==='checkbox')value=input.checked;if(input.type==='radio'){if(!input.checked)return;value=choice??'';}}if(input instanceof HTMLSelectElement&&input.multiple)value=[...input.selectedOptions].map(option=>option.value);this.draft.values.set(field.name,value);if(JSON.stringify(value)===JSON.stringify(original(field)))this.draft.modified.delete(field.name);else this.draft.modified.add(field.name);input.removeAttribute('aria-invalid');for(const [other,meta] of this.bindings)if(other!==input&&meta.field.name===field.name)this.sync(other,meta);this.changed();};
    input.addEventListener(textInput?'input':'change',change);if(field.type==='dropdown'&&field.editable)input.addEventListener('blur',()=>this.sync(input,binding));return input;
  }
  private sync(input:Control,{field,choice}:Binding):void{
    const value=this.draft.values.get(field.name);
    if(input instanceof HTMLInputElement&&input.type==='checkbox')input.checked=value===true;
    else if(input instanceof HTMLInputElement&&input.type==='radio')input.checked=value===choice;
    else if(input instanceof HTMLSelectElement&&input.multiple)for(const option of input.options)option.selected=Array.isArray(value)&&value.includes(option.value);
    else {let text=typeof value==='string'?value:'';if(field.type==='dropdown'&&field.editable)text=formChoiceOptions(field).find(choice=>choice.value===text)?.label??text;if(input.value!==text)input.value=text;}
  }
  private paintList():void{
    this.status.textContent=this.fields.length+' form fields · Values stay in this document session. Review the exported PDF before sharing.';
    const list=document.createElement('div');list.dataset.formFieldList='';
    this.fields.forEach(field=>{const row=document.createElement('div');row.className='df2-form-row';const heading=document.createElement('p');heading.textContent=field.name+(field.required?' · Required':'')+(field.readOnly?' · Read only':'');row.append(heading);
      if(supported.has(field.type))row.append(this.control(field,false,field.name));else{const warning=document.createElement('p');warning.textContent='This field type cannot be edited here and will remain unchanged.';row.append(warning);}
      const page=field.widgets?.[0]?.page;if(page){const button=document.createElement('button');button.type='button';button.textContent='Show on page '+page;button.setAttribute('aria-label','Show '+field.name+' on page '+page);button.addEventListener('click',()=>{void this.jump(page).then(()=>{if(this.disposed)return;const input=[...this.bindings].find(([,meta])=>meta.overlay&&meta.field.name===field.name)?.[0];input?.focus();});});row.append(button);}list.append(row);
    });this.host.append(list);
  }
  clearPage():void{this.overlay.hidden=true;for(const [input,binding] of this.bindings)if(binding.overlay)this.bindings.delete(input);this.overlay.replaceChildren();}
  private rendered=():void=>this.paintOverlay();
  private paintOverlay():void{
    if(!this.ready||this.disposed)return;const detail=renderedPage(this.canvas);if(!detail)return;
    const focused=document.activeElement instanceof HTMLElement&&this.overlay.contains(document.activeElement)?document.activeElement.dataset.formField:undefined;
    this.clearPage();const bounds=this.canvas.getBoundingClientRect(),origin=this.paper.getBoundingClientRect();Object.assign(this.overlay.style,{left:bounds.x-origin.x+'px',top:bounds.y-origin.y+'px',width:bounds.width+'px',height:bounds.height+'px'});this.overlay.hidden=false;
    for(const field of this.fields)if(supported.has(field.type))for(const widget of field.widgets??[]){
      if(widget.page!==detail.pageNumber||!widget.rect||!Object.values(widget.rect).every(Number.isFinite))continue;
      const choice=field.type==='radio'?widget.choice:undefined;if(field.type==='radio'&&(choice===undefined||!field.choices?.includes(choice)))continue;
      const {x,y,width,height}=widget.rect,points=detail.viewport.convertToViewportRectangle([x,y,x+width,y+height]),input=this.control(field,true,'On page '+widget.page+': '+field.name+(choice?' · '+choice:''),choice);input.classList.add('df2-form-page-input');
      Object.assign(input.style,{left:Math.min(points[0]!,points[2]!)/detail.viewport.width*100+'%',top:Math.min(points[1]!,points[3]!)/detail.viewport.height*100+'%',width:Math.abs(points[2]!-points[0]!)/detail.viewport.width*100+'%',height:Math.abs(points[3]!-points[1]!)/detail.viewport.height*100+'%'});this.overlay.append(input);
    }
    if(focused)[...this.bindings].find(([,binding])=>binding.overlay&&binding.field.name===focused)?.[0].focus({preventScroll:true});
  }
  exportValues():string{
    if(!this.ready)throw Error('Wait for supported form fields to finish loading. Check the field panel for any inspection error.');
    const missing=this.fields.find(field=>field.required&&!field.readOnly&&empty(this.draft.values.get(field.name)));
    if(missing){const focus=document.activeElement;this.reveal();const input=[...this.bindings].find(([,binding])=>!binding.overlay&&binding.field.name===missing.name)?.[0];input?.setAttribute('aria-invalid','true');let frames=0;const focusWhenVisible=()=>{if(this.disposed||document.activeElement!==focus||!input?.isConnected)return;if(getComputedStyle(input).visibility==='visible')input.focus();else if(++frames<30)requestAnimationFrame(focusWhenVisible);};requestAnimationFrame(focusWhenVisible);throw Error('Complete the required field: '+missing.name);}
    return JSON.stringify(Object.fromEntries(this.fields.filter(field=>supported.has(field.type)&&!field.readOnly&&this.draft.modified.has(field.name)).map(field=>[field.name,this.draft.values.get(field.name)])));
  }
  dispose():void{this.disposed=true;this.operation?.cancel();this.operation=null;this.canvas.removeEventListener('docflow-page-rendered',this.rendered);this.bindings.clear();this.overlay.remove();this.host.replaceChildren();}
}
