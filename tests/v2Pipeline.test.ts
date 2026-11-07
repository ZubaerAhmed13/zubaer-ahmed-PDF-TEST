import {expect,it} from 'vitest';
import {createPipeline,runPipeline,validatePipelineFiles} from '../src/v2/pipeline';
import type {WorkflowStarter,WorkflowRecipe} from '../src/workflows/workflowEngine';
import {createPipelineDraft} from '../src/v2/pipelineEditor';
const header=()=>new TextEncoder().encode('%PDF-1.7').buffer;
const recipe:WorkflowRecipe={id:'recipe',name:'Rotate',steps:[{id:'rotate',operation:'rotate',options:{degrees:90}}]};
function file(name:string,reads:string[]){return {name,size:8,type:'application/pdf',arrayBuffer:async()=>{reads.push(name);return header();}} as File;}
const preflight={outputs:[],info:{preflight:JSON.stringify({inputPages:2,outputPages:2,steps:[]})}};
it('initial workflow steps expose the real default controls, including compression settings',()=>{expect(createPipelineDraft(false).steps[1]!.options).toMatchObject({quality:78,maxImageDimension:2200});});
it('rejects oversized metadata without reading a file',()=>{expect(()=>validatePipelineFiles([{size:51*1024*1024}])).toThrow('50 MB');expect(()=>validatePipelineFiles(Array.from({length:21},()=>({size:1})))).toThrow('20 PDFs');expect(()=>validatePipelineFiles(Array.from({length:4},()=>({size:40*1024*1024})))).toThrow('150 MB');});
it('reads and processes one file at a time and continues after a failed file',async()=>{
  const reads:string[]=[],calls:string[]=[],report=createPipeline([file('one.pdf',reads),file('bad.pdf',reads),file('two.pdf',reads)],recipe);let running=0,max=0;
  const start:WorkflowStarter=(operation,files)=>{running++;max=Math.max(max,running);calls.push(files[0]!.name+':'+operation);return {cancel:()=>{},result:Promise.resolve().then(()=>{running--;if(files[0]!.name==='bad.pdf')throw Error('Broken');return operation==='workflow-preflight'?preflight:{outputs:[{name:'result.pdf',type:'application/pdf',buffer:header()}]};})};};
  await runPipeline(report,start,{cancelled:()=>false,active:()=>{},update:()=>{}});expect(max).toBe(1);expect(reads).toEqual(['one.pdf','one.pdf','bad.pdf','two.pdf','two.pdf']);expect(calls).toEqual(['one.pdf:workflow-preflight','one.pdf:rotate','bad.pdf:workflow-preflight','two.pdf:workflow-preflight','two.pdf:rotate']);expect(report.items.map(i=>i.state)).toEqual(['complete','failed','complete']);
});
it('retry uses the previous immutable settings and retains successful output',async()=>{
  const reads:string[]=[],files=[file('one.pdf',reads),file('two.pdf',reads)],report=createPipeline(files,recipe);report.items[0]!.state='complete';report.items[0]!.output={name:'one.pdf',type:'application/pdf',buffer:header()};report.items[1]!.state='failed';recipe.steps[0]!.options.degrees=180;
  const retry=createPipeline(files,recipe,report),angles:unknown[]=[];const start:WorkflowStarter=(op,_,options)=>{if(op==='rotate')angles.push(options.degrees);return {cancel:()=>{},result:Promise.resolve(op==='workflow-preflight'?preflight:{outputs:[{name:'result.pdf',type:'application/pdf',buffer:header()}]})};};
  await runPipeline(retry,start,{cancelled:()=>false,active:()=>{},update:()=>{}});expect(angles).toEqual([90]);expect(retry.items[0]!.output).toBe(report.items[0]!.output);expect(reads).toEqual(['two.pdf','two.pdf']);recipe.steps[0]!.options.degrees=90;
});
it('cancellation retains completed output and never reads later originals',async()=>{
  const reads:string[]=[],report=createPipeline([file('one.pdf',reads),file('two.pdf',reads),file('three.pdf',reads)],recipe);let cancelled=false;
  const start:WorkflowStarter=(op,files)=>({cancel:()=>{},result:Promise.resolve().then(()=>{if(op==='workflow-preflight'){if(files[0]!.name==='two.pdf')cancelled=true;return preflight;}return {outputs:[{name:'done.pdf',type:'application/pdf',buffer:header()}]};})});
  await runPipeline(report,start,{cancelled:()=>cancelled,active:()=>{},update:()=>{}});expect(report.items.map(i=>i.state)).toEqual(['complete','cancelled','cancelled']);expect(reads).toEqual(['one.pdf','one.pdf','two.pdf']);expect(report.items[0]!.output).toBeDefined();expect(report.cancelled).toBe(true);
});
it('retry does not validate newly edited invalid controls instead of its valid prior snapshot',()=>{
  const reads:string[]=[],files=[file('one.pdf',reads)],report=createPipeline(files,recipe);report.items[0]!.state='failed';const invalid={...recipe,steps:[{id:'empty',operation:'extract-pages' as const,options:{pages:''}}]};
  expect(createPipeline(files,invalid,report).items[0]!.recipe.steps[0]!.operation).toBe('rotate');
});
it('retrying failed checks does not execute the other checked originals',async()=>{
  const reads:string[]=[],files=[file('checked.pdf',reads),file('failed.pdf',reads)],report=createPipeline(files,recipe);report.items[0]!.state='checked';report.items[1]!.state='failed';
  const retry=createPipeline(files,recipe,report),start:WorkflowStarter=op=>({cancel:()=>{},result:Promise.resolve(op==='workflow-preflight'?preflight:{outputs:[{name:'done.pdf',type:'application/pdf',buffer:header()}]})});
  await runPipeline(retry,start,{cancelled:()=>false,active:()=>{},update:()=>{}});expect(reads).toEqual(['failed.pdf','failed.pdf']);expect(retry.items[0]!.state).toBe('checked');
});
