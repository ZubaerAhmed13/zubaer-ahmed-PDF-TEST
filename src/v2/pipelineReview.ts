import {mountPdfReview} from './pdfReview';
import {pipelineSummary,type PipelineReport} from './pipeline';
export type PipelineReviewData={kind:'pipeline';report:PipelineReport};
const node=(tag:string,text:string)=>{const el=document.createElement(tag);el.textContent=text;return el;};
export function mountPipelineReport(host:HTMLElement,report:PipelineReport):void{
  const summary=node('p',pipelineSummary(report));summary.dataset.pipelineSummary='';summary.setAttribute('role','status');host.append(summary);
  const list=node('div','');list.dataset.pipelineReport='';
  report.items.forEach(item=>{const row=node('article','');row.className='df2-pipeline-row';row.dataset.state=item.state;row.append(node('strong',item.file.name+' · '+item.state),node('p',item.message));if(item.preflight){const details=node('details',''),count=item.preflight.steps.reduce((sum,step)=>sum+step.warnings.length,0);details.append(node('summary',item.preflight.steps.length+' steps · '+count+' preservation notes'));for(const [i,step] of item.preflight.steps.entries()){details.append(node('p','Step '+(i+1)+' · '+step.operation+' · '+step.affectedPages+' pages'));for(const warning of step.warnings)details.append(node('p',warning));}row.append(details);}list.append(row);});host.append(list);
}
export function mountPipelineReview(host:HTMLElement,data:PipelineReviewData):()=>void{
  mountPipelineReport(host,data.report);const outputs=data.report.items.flatMap(item=>item.output?[item.output]:[]);let dispose=()=>{};
  if(outputs.length){const select=document.createElement('select');select.setAttribute('aria-label','Review completed PDF');outputs.forEach((out,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=out.name;select.append(option);});const preview=document.createElement('section');host.append(select,preview);const show=()=>{dispose();preview.replaceChildren();const output=outputs[Number(select.value)];if(output)dispose=mountPdfReview(preview,{kind:'pdf',title:'Review '+output.name,buffer:output.buffer});};select.addEventListener('change',show);show();return ()=>{select.removeEventListener('change',show);dispose();host.replaceChildren();};}
  return ()=>host.replaceChildren();
}
