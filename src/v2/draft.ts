import {EditHistory} from '../pdf/editModel';

/** Session state outlives disposable editor/organiser DOM. Never store passwords. */
export interface EditorDraft { history: EditHistory; selected: string | null; native: {enabled:boolean;selected:string|null;pending:Record<string,{text:string;font:'original'|'docflow'}>}; }
export const createEditorDraft=():EditorDraft=>({history:new EditHistory(),selected:null,native:{enabled:false,selected:null,pending:{}}});
export interface OrganizerDraft { order:number[]; history:number[][]; future:number[][]; }
export const createOrganizerDraft=():OrganizerDraft=>({order:[],history:[],future:[]});
export function safeOptionValues(form:HTMLFormElement):Record<string,string|boolean>{
  const values:Record<string,string|boolean>={};
  for(const el of form.elements){
    if(!(el instanceof HTMLInputElement||el instanceof HTMLSelectElement||el instanceof HTMLTextAreaElement)||!el.name)continue;
    if(el instanceof HTMLInputElement&&['password','file'].includes(el.type))continue;
    values[el.name]=el instanceof HTMLInputElement&&el.type==='checkbox'?el.checked:el.value;
  }
  return values;
}
export function restoreOptions(form:HTMLFormElement,values:Record<string,string|boolean>):void{
  for(const el of form.elements){
    if(!(el instanceof HTMLInputElement||el instanceof HTMLSelectElement||el instanceof HTMLTextAreaElement))continue;
    const value=values[el.name];if(value===undefined)continue;
    if(el instanceof HTMLInputElement&&['password','file'].includes(el.type))continue;
    if(el instanceof HTMLInputElement&&el.type==='checkbox')el.checked=value===true;
    else el.value=String(value);
  }
}
