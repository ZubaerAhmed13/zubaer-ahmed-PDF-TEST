import type {InputFile,OutputFile} from '../pdf/types';
import type {RunningOperation} from '../pdf/workerClient';
import {executeWorkflow,validateRecipe,MAX_FILES,MAX_FILE_BYTES,MAX_BATCH_BYTES,type WorkflowRecipe,type WorkflowStarter} from '../workflows/workflowEngine';
import type {WorkflowPreflight} from '../workflows/workflowPreflight';
import {workflowOutputName,DEFAULT_OUTPUT_PATTERN} from '../workflows/recipeTransfer';

export type PipelineItem={file:File;state:'pending'|'checking'|'checked'|'running'|'complete'|'failed'|'cancelled';message:string;recipe:WorkflowRecipe;output?:OutputFile;preflight?:WorkflowPreflight};
export type PipelineReport={items:PipelineItem[];cancelled:boolean;retrying?:boolean};
export function validatePipelineFiles(files:readonly Pick<File,'size'>[]):void{
  if(files.length>MAX_FILES||files.some(f=>!f.size||f.size>MAX_FILE_BYTES)||files.reduce((sum,f)=>sum+f.size,0)>MAX_BATCH_BYTES)throw Error('Queue limits: 20 PDFs, 50 MB each and 150 MB combined.');
}
export function createPipeline(files:readonly File[],recipe:WorkflowRecipe,previous?:PipelineReport):PipelineReport{
  validatePipelineFiles(files);
  if(previous&&previous.items.length===files.length&&previous.items.every((item,i)=>item.file===files[i]))return {cancelled:false,retrying:true,items:previous.items.map(item=>({...item,recipe:structuredClone(item.recipe),...(item.state==='failed'||item.state==='cancelled'?{state:'pending' as const,message:'Waiting to retry',output:undefined,preflight:undefined}:{})}))};
  const snapshot=validateRecipe(recipe);return {cancelled:false,items:files.map(file=>({file,state:'pending',message:'Waiting',recipe:structuredClone(snapshot)}))};
}
export async function runPipeline(report:PipelineReport,start:WorkflowStarter,control:{cancelled:()=>boolean;active:(job:RunningOperation|null)=>void;update:(message:string)=>void;checkOnly?:boolean}):Promise<void>{
  const {cancelled,active,update}=control;
  const read=async(file:File):Promise<InputFile>=>{if(cancelled())throw new DOMException('Cancelled','AbortError');const buffer=await file.arrayBuffer();if(cancelled())throw new DOMException('Cancelled','AbortError');return {name:file.name,type:'application/pdf',buffer};};
  for(const [index,item] of report.items.entries()){
    if(item.state==='complete'||(report.retrying&&item.state!=='pending'))continue;
    if(cancelled()){item.state='cancelled';item.message='Cancelled before processing';report.cancelled=true;continue;}
    item.output=undefined;
    try{
      item.state='checking';item.message='Checking steps and page selections';update(item.file.name+': '+item.message);
      const input=await read(item.file);const check=start('workflow-preflight',[input],{steps:item.recipe.steps},()=>{});active(check);
      let result;try{result=await check.result;}finally{active(null);}
      if(cancelled())throw new DOMException('Cancelled','AbortError');
      item.preflight=JSON.parse(String(result.info?.preflight)) as WorkflowPreflight;
      if(!item.preflight||!Number.isInteger(item.preflight.inputPages)||!Number.isInteger(item.preflight.outputPages)||!Array.isArray(item.preflight.steps))throw Error('Invalid preflight report.');
      if(control.checkOnly){item.state='checked';item.message=item.preflight.inputPages+' → '+item.preflight.outputPages+' pages; original unchanged';update(item.file.name+': '+item.message);continue;}
      item.state='running';item.message='Processing';update(item.file.name+': '+item.message);
      const output=await executeWorkflow(await read(item.file),item.recipe.steps,start,cancelled,event=>{item.message='Step '+event.step+'/'+event.totalSteps+' · '+event.message+' · '+Math.round(event.percent)+'%';update('File '+(index+1)+'/'+report.items.length+' · '+item.file.name+': '+item.message);},active);
      if(cancelled())throw new DOMException('Cancelled','AbortError');
      const total=report.items.reduce((sum,other)=>sum+(other.output?.buffer.byteLength??0),0)+output.buffer.byteLength;
      if(total>MAX_BATCH_BYTES)throw Error('Completed PDFs exceed the 150 MB output limit. Use a smaller queue.');
      const base=workflowOutputName(item.file.name,index+1,DEFAULT_OUTPUT_PATTERN,item.recipe.name);let name=base,suffix=2;const names=new Set(report.items.flatMap(other=>other.output?[other.output.name.toLowerCase()]:[]));while(names.has(name.toLowerCase()))name=base.replace(/\.pdf$/i,'')+'-'+suffix+++'.pdf';
      item.output={...output,name};item.state='complete';item.message=item.preflight.inputPages+' → '+item.preflight.outputPages+' pages';
    }catch(error){
      const aborted=cancelled()||(error instanceof DOMException&&error.name==='AbortError');item.state=aborted?'cancelled':'failed';item.message=aborted?'Cancelled':error instanceof Error?error.message:'Processing failed';if(aborted)report.cancelled=true;
    }finally{active(null);update(item.file.name+': '+item.message);}
  }
}
export const pipelineSummary=(report:PipelineReport):string=>['complete','failed','cancelled','checked'].map(state=>report.items.filter(item=>item.state===state).length+' '+state).join(' · ');
