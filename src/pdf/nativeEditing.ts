import {PDFDocument} from 'pdf-lib';
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import {applyDirectEdit,frameFor} from './directEdit';
import {inspectDocument} from './documentInspection';
import type {EditPlan} from './editModel';
import type {InputFile,OperationResult} from './types';
import type {NativeEditPlan,ResolvedNativePlan} from './nativeModel';
import type {NativePdfium} from './nativePdfium';
import {encodedImageDimensions,nativeEditError} from './nativeModel';

let loading:Promise<NativePdfium>|undefined;
function engine():Promise<NativePdfium>{
  return loading??=(async()=>{
    const [{createNativePdfium},response]=await Promise.all([import('./nativePdfium'),fetch(wasmUrl)]);
    if(!response.ok)throw nativeEditError('The source editor could not load. Reconnect and retry.');
    return createNativePdfium(new Uint8Array(await response.arrayBuffer()));
  })().catch(e=>{loading=undefined;throw e;});
}
async function source(files:InputFile[]){
  if(!files[0])throw nativeEditError('Choose a PDF first.');
  const report=await inspectDocument(files[0].buffer);
  if(report.signed||report.certified)throw nativeEditError('Signed or certified PDFs cannot be changed with the source editor. Use an unsigned original.');
  const doc=await PDFDocument.load(files[0].buffer,{updateMetadata:false});
  return {bytes:new Uint8Array(files[0].buffer),frames:doc.getPages().map(frameFor)};
}
async function resolve(plan:NativeEditPlan):Promise<ResolvedNativePlan>{
  if(!plan||!Array.isArray(plan.edits)||plan.edits.length>1000||JSON.stringify(plan).length>16*1024*1024)throw nativeEditError('The source edit plan exceeds its local memory budget.');
  const edits:ResolvedNativePlan['edits']=[];
  let decodedBytes=0;
  for(const edit of plan.edits){
    if(edit.kind!=='image'){edits.push(edit);continue;}
    if(typeof edit.data!=='string'||edit.data.length>14*1024*1024||!/^data:image\/(png|jpeg);base64,[a-z\d+/=]+$/i.test(edit.data))throw nativeEditError('Choose a PNG or JPEG up to 10 MB.');
    const payload=atob(edit.data.slice(edit.data.indexOf(',')+1));
    if(payload.length>10*1024*1024)throw nativeEditError('Choose an image up to 10 MB.');
    const encoded=Uint8Array.from(payload,c=>c.charCodeAt(0)),dimensions=encodedImageDimensions(encoded);
    decodedBytes+=dimensions.width*dimensions.height*4;
    if(decodedBytes>64*1024*1024)throw nativeEditError('Decoded source edits exceed the 64 MB memory budget.');
    const blob=new Blob([encoded]);
    const bitmap=await createImageBitmap(blob);
    try{
      const {width,height}=bitmap;
      if(width!==dimensions.width||height!==dimensions.height)throw nativeEditError('The replacement image dimensions do not match its header.');
      if(width>8192||height>8192||width*height>16_000_000)throw nativeEditError('Replacement images support at most 16 million pixels and 8,192 pixels per side.');
      const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d');
      if(!ctx)throw nativeEditError('The image decoder is unavailable.');
      ctx.drawImage(bitmap,0,0);const rgba=new Uint8Array(ctx.getImageData(0,0,width,height).data);
      edits.push({id:edit.id,kind:'image',image:{width,height,rgba}});canvas.width=canvas.height=1;
    }finally{bitmap.close();}
  }
  return {fingerprint:plan.fingerprint,edits};
}
export async function inspectNativeContent(files:InputFile[],options:Record<string,unknown>):Promise<OperationResult>{
  const {bytes,frames}=await source(files),page=Number(options.page),frame=frames[page-1];
  if(!Number.isInteger(page)||!frame)throw nativeEditError('Choose an existing page.');
  const inspection=await(await engine()).inspect(bytes,page,frame);
  return {outputs:[],info:{inspection:JSON.stringify(inspection)}};
}
export async function previewNativeContent(files:InputFile[],options:Record<string,unknown>):Promise<OperationResult>{
  const {bytes,frames}=await source(files),plan=options.source as NativeEditPlan;
  const resolved=await resolve(plan);
  let font:Uint8Array|undefined;
  if(plan.edits.some(e=>e.kind==='text'&&e.font==='docflow')){
    const response=await fetch(`${import.meta.env.BASE_URL}native-fonts/DocFlowSourceSans.ttf`);
    if(!response.ok)throw nativeEditError('The DocFlow source font is unavailable. Reconnect and retry.');
    font=new Uint8Array(await response.arrayBuffer());
  }
  const output=await(await engine()).apply(bytes,resolved,frames,font);
  return {outputs:[{name:'edited.pdf',type:'application/pdf',buffer:output.slice().buffer}],info:{nativeChanges:plan.edits.length}};
}
export async function applyEditorChanges(files:InputFile[],options:Record<string,unknown>):Promise<OperationResult>{
  const plan=options.plan as EditPlan;
  if(!plan?.source?.edits.length)return applyDirectEdit(files,options);
  const native=await previewNativeContent(files,{source:plan.source});
  if(!plan.objects.length&&!Object.keys(plan.crops).length&&!plan.removedComments.length)return native;
  // Source annotation references can change during a native rewrite. Match them
  // by page/annotation position before handing the rewritten PDF to additions.
  const before=await PDFDocument.load(files[0]!.buffer,{updateMetadata:false}),after=await PDFDocument.load(native.outputs[0]!.buffer,{updateMetadata:false});
  const refs=new Map<string,string>();
  before.getPages().forEach((page,index)=>{
    const original=page.node.Annots(),rewritten=after.getPage(index).node.Annots();
    for(let i=0;original&&rewritten&&i<original.size();i++)if(i<rewritten.size())refs.set(`${index}:${original.get(i).toString()}`,`${index}:${rewritten.get(i).toString()}`);
  });
  const additions=structuredClone(plan);delete additions.source;
  additions.objects.forEach(o=>{if(o.originalId){const mapped=refs.get(o.originalId);if(!mapped)throw nativeEditError('A source annotation could not be preserved for this edit.');o.originalId=mapped;}});
  additions.removedComments=additions.removedComments.map(id=>{const mapped=refs.get(id);if(!mapped)throw nativeEditError('A removed annotation could not be matched.');return mapped;});
  return applyDirectEdit([{...files[0]!,buffer:native.outputs[0]!.buffer},...files.slice(1)],{...options,plan:additions});
}
