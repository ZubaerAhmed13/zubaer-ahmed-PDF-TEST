import {WORKFLOW_OPERATIONS,DEFAULT_WORKFLOW_RECIPES,MAX_STEPS,defaultOptions,readRecipes,storeRecipes,validateRecipe,type WorkflowRecipe,type WorkflowOperation} from '../workflows/workflowEngine';
import {exportRecipe,importRecipe,MAX_RECIPE_BYTES} from '../workflows/recipeTransfer';
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const choice:Record<string,[string,string][]>= {
  target:[['all','All pages'],['odd','Odd pages'],['even','Even pages'],['selected','Selected pages']],degrees:[['90','90° clockwise'],['180','180°'],['270','270° clockwise']],format:[['page-total','Page 1 of N'],['fraction','1 / N'],['page','Page 1'],['number','1']],action:[['edit','Update specified properties'],['clear','Clear standard properties']]
};
const labels:Record<string,string>={target:'Apply to',degrees:'Rotation',pages:'Pages (blank means all; required for selection)',format:'Number format',start:'Start at',fontSize:'Font size (pt)',margin:'Bottom margin (pt)',text:'Watermark text',opacity:'Opacity (0.05–1)',rotation:'Angle (degrees)',left:'Left crop (pt)',right:'Right crop (pt)',top:'Top crop (pt)',bottom:'Bottom crop (pt)',action:'Change',title:'Title (blank = unchanged)',author:'Author (blank = unchanged)',subject:'Subject (blank = unchanged)',creator:'Creator (blank = unchanged)',keywords:'Keywords (comma separated)',quality:'JPEG quality (effective range 50–95)',maxImageDimension:'Maximum image dimension (900–5000 px)'};
export function createPipelineDraft(batch:boolean):WorkflowRecipe{return validateRecipe(batch?{id:crypto.randomUUID(),name:'Batch',steps:[{id:crypto.randomUUID(),operation:'rotate',options:defaultOptions('rotate')}]}:structuredClone({...DEFAULT_WORKFLOW_RECIPES[0]!,id:crypto.randomUUID()}));}
export class V2PipelineEditor{
  private disposed=false;
  private revision=0;
  constructor(private host:HTMLElement,private draft:WorkflowRecipe,private batch:boolean,private changed:()=>void){host.dataset.pipelineEditor='';host.classList.add('df2-pipeline-editor');host.addEventListener('click',this.click);host.addEventListener('input',this.input);host.addEventListener('change',this.change);this.paint();}
  get recipe():WorkflowRecipe{return validateRecipe(this.draft);}
  cancelPendingImport():void{++this.revision;}
  private operations(){return WORKFLOW_OPERATIONS.filter(op=>!this.batch||['rotate','page-numbers','watermark','optimize'].includes(op.id));}
  private operationOptions(selected:string){return this.operations().map(op=>`<option value="${op.id}" ${selected===op.id?'selected':''}>${op.label}</option>`).join('');}
  private paint(presetId?:string):void{
    const expanded=this.host.querySelector('details')?.open??false,selected=presetId??this.host.querySelector<HTMLSelectElement>('[data-recipe-select]')?.value;
    const active=document.activeElement instanceof HTMLElement&&this.host.contains(document.activeElement)?document.activeElement:null;
    const focusKey=active?['data-step-operation','data-step-option','data-recipe-name','data-recipe-select','data-recipe-use','data-recipe-save','data-recipe-delete','data-recipe-export','data-recipe-import'].find(key=>active.hasAttribute(key)):undefined;
    const focusValue=focusKey?active!.getAttribute(focusKey):null,focusStep=active?.closest<HTMLElement>('[data-step-id]')?.dataset.stepId;
    const saved=(()=>{try{return readRecipes(localStorage);}catch{return [];}})();
    this.host.innerHTML=`<p>Runs locally, one PDF and one step at a time. Maximum 20 PDFs, 50 MB each and 150 MB combined. Page selections refer to the output of the preceding step.</p><p class="df2-organize-warning">Page-copy steps lose document bookmarks, labels, editable forms, attachments, metadata and tags. Crop hides content rather than redacting it. Optimisation can change image pixels and may increase file size. Rewrites invalidate existing certificate signatures. Check files to review each step's consequences.</p>
      ${this.batch?'':`<label class="df2-control">Workflow name<input data-recipe-name maxlength="60" value="${esc(this.draft.name)}"></label><details><summary>Reusable workflows</summary><p>Save stores recipe settings on this device. PDF files are never saved here.</p><label class="df2-control">Preset<select data-recipe-select>${[...DEFAULT_WORKFLOW_RECIPES,...saved].map(recipe=>`<option value="${recipe.id}">${esc(recipe.name)}</option>`).join('')}</select></label><div class="df2-pipeline-actions"><button type="button" data-recipe-use>Use preset</button><button type="button" data-recipe-save>Save on device</button><button type="button" data-recipe-delete>Delete selected saved preset</button><button type="button" data-recipe-export>Export recipe</button><label class="df2-pipeline-import">Import recipe<input type="file" data-recipe-import accept=".json,application/json"></label></div></details>`}
      <div data-pipeline-steps>${this.draft.steps.map((step,index)=>`<fieldset data-step-id="${step.id}"><legend>${this.batch?'Operation':'Step '+(index+1)}</legend><label class="df2-control">Operation<select data-step-operation>${this.operationOptions(step.operation)}</select></label>${Object.entries(step.options).map(([key,value])=>`<label class="df2-control">${labels[key]??key}${choice[key]?`<select data-step-option="${key}">${choice[key]!.map(([v,label])=>`<option value="${v}" ${String(value)===v?'selected':''}>${label}</option>`).join('')}</select>`:`<input data-step-option="${key}" type="${typeof value==='number'?'number':'text'}" ${typeof value==='number'?'step="any"':''} value="${esc(String(value))}">`}</label>`).join('')}${this.batch?'':`<div class="df2-pipeline-actions"><button type="button" data-step-up aria-label="Move step ${index+1} up" ${index===0?'disabled':''}>↑ Up</button><button type="button" data-step-down aria-label="Move step ${index+1} down" ${index===this.draft.steps.length-1?'disabled':''}>↓ Down</button><button type="button" data-step-remove aria-label="Remove step ${index+1}" ${this.draft.steps.length===1?'disabled':''}>Remove</button></div>`}</fieldset>`).join('')}</div>
      ${this.batch?'':`<label class="df2-control">Next operation<select data-add-operation>${this.operationOptions('rotate')}</select></label><button type="button" data-step-add ${this.draft.steps.length>=MAX_STEPS?'disabled':''}>Add step</button>`}<p data-pipeline-editor-status role="status" aria-live="polite"></p><div class="df2-pipeline-actions"><button type="button" data-pipeline-check>Check files</button><button type="button" data-pipeline-retry>Retry failed or cancelled files using prior settings</button></div>`;
    const details=this.host.querySelector('details');if(details)details.open=expanded;
    const presets=this.host.querySelector<HTMLSelectElement>('[data-recipe-select]');if(presets&&[...presets.options].some(option=>option.value===selected))presets.value=selected!;
    if(focusKey){const target=[...this.host.querySelectorAll<HTMLElement>('['+focusKey+']')].find(el=>el.getAttribute(focusKey)===focusValue&&el.closest<HTMLElement>('[data-step-id]')?.dataset.stepId===focusStep);target?.focus({preventScroll:true});}
  }
  private message(value:string){const node=this.host.querySelector('[data-pipeline-editor-status]');if(node)node.textContent=value;}
  private input=(event:Event):void=>{
    const target=event.target;if(!(target instanceof HTMLInputElement||target instanceof HTMLSelectElement))return;
    if(target.hasAttribute('data-recipe-name')){++this.revision;this.draft.name=target.value;this.message('');this.changed();}
    if(target.hasAttribute('data-recipe-select'))++this.revision;
    const key=target.dataset.stepOption,step=this.draft.steps.find(s=>s.id===target.closest<HTMLElement>('[data-step-id]')?.dataset.stepId);
    if(key&&step){++this.revision;step.options[key]=typeof defaultOptions(step.operation)[key]==='number'?Number(target.value):target.value;this.message('');this.changed();}
  };
  private change=(event:Event):void=>{
    const target=event.target;if(!(target instanceof HTMLInputElement||target instanceof HTMLSelectElement))return;
    if(target.hasAttribute('data-step-operation')){const step=this.draft.steps.find(s=>s.id===target.closest<HTMLElement>('[data-step-id]')?.dataset.stepId);if(step){++this.revision;step.operation=target.value as WorkflowOperation;step.options=defaultOptions(step.operation);this.changed();this.paint();}}
    if(target instanceof HTMLInputElement&&target.hasAttribute('data-recipe-import')&&target.files?.[0]){
      const file=target.files[0];if(file.size>MAX_RECIPE_BYTES){this.message('Recipe files must be at most 64 KB.');target.value='';return;}
      const revision=++this.revision;this.message('Importing recipe…');
      void file.text().then(text=>{if(this.disposed||revision!==this.revision)return;Object.assign(this.draft,importRecipe(text));this.changed();this.paint();this.message('Recipe imported. Review the steps before running.');}).catch(error=>{if(!this.disposed&&revision===this.revision)this.message(error instanceof Error?error.message:'Import failed.');});
    }
  };
  private click=(event:Event):void=>{
    const button=event.target instanceof Element?event.target.closest<HTMLButtonElement>('button'):null;if(!button)return;
    try{
      if(button.matches('[data-step-add],[data-step-up],[data-step-down],[data-step-remove],[data-recipe-use],[data-recipe-save],[data-recipe-delete],[data-recipe-export]'))++this.revision;
      const index=this.draft.steps.findIndex(s=>s.id===button.closest<HTMLElement>('[data-step-id]')?.dataset.stepId);
      if(button.hasAttribute('data-step-add')){if(this.draft.steps.length>=MAX_STEPS)return;const operation=this.host.querySelector<HTMLSelectElement>('[data-add-operation]')!.value as WorkflowOperation;this.draft.steps.push({id:crypto.randomUUID(),operation,options:defaultOptions(operation)});this.changed();this.paint();this.host.querySelector<HTMLElement>('fieldset:last-child select')?.focus();}
      if(index>=0&&button.matches('[data-step-up],[data-step-down],[data-step-remove]')){
        if(button.hasAttribute('data-step-remove')){if(this.draft.steps.length===1)return;this.draft.steps.splice(index,1);}else{const next=index+(button.hasAttribute('data-step-up')?-1:1);if(next<0||next>=this.draft.steps.length)return;[this.draft.steps[index],this.draft.steps[next]]=[this.draft.steps[next]!,this.draft.steps[index]!];}
        this.changed();this.paint();this.host.querySelectorAll<HTMLElement>('[data-step-operation]')[Math.min(index,this.draft.steps.length-1)]?.focus();
      }
      const selected=this.host.querySelector<HTMLSelectElement>('[data-recipe-select]')?.value;
      if(button.hasAttribute('data-recipe-use')){const recipe=[...DEFAULT_WORKFLOW_RECIPES,...readRecipes(localStorage)].find(r=>r.id===selected);if(recipe){Object.assign(this.draft,validateRecipe(structuredClone(recipe)));this.changed();this.paint();this.message('Preset loaded. Review its steps before running.');}}
      if(button.hasAttribute('data-recipe-save')){const recipe=this.recipe,saved=readRecipes(localStorage).filter(r=>r.id!==recipe.id);if(recipe.id.startsWith('built-in-'))recipe.id=crypto.randomUUID();storeRecipes(localStorage,[...saved,recipe]);this.draft.id=recipe.id;this.paint(recipe.id);this.message('Recipe settings saved on this device.');}
      if(button.hasAttribute('data-recipe-delete')){if(DEFAULT_WORKFLOW_RECIPES.some(r=>r.id===selected))throw Error('Built-in presets cannot be deleted.');storeRecipes(localStorage,readRecipes(localStorage).filter(r=>r.id!==selected));this.paint();this.message('Saved preset deleted.');}
      if(button.hasAttribute('data-recipe-export')){const text=exportRecipe(this.recipe),url=URL.createObjectURL(new Blob([text],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='docflow-workflow.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),0);}
    }catch(error){this.message(error instanceof Error?error.message:'Could not update workflow.');}
  };
  dispose():void{this.disposed=true;this.host.removeEventListener('click',this.click);this.host.removeEventListener('input',this.input);this.host.removeEventListener('change',this.change);}
}
