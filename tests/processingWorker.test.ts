import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {createWorker,type WorkerVM,type VMOptions} from '../backend/worker';
import {NOTICE_VERSION} from '../backend/contracts';

const project='https://project.supabase.co',broker=project+'/functions/v1/docflow-processing',job='20000000-0000-4000-8000-000000000001',owner='10000000-0000-4000-8000-000000000001',secret='d'.repeat(64),name='df-'+job+'-1';
const input=new TextEncoder().encode('%PDF-1.7\ninput-data\n'),output=new TextEncoder().encode('%PDF-1.7\nhello-data\n');
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const request={operation:'ocr',idempotencyKey:'30000000-0000-4000-8000-000000000001',consent:{accepted:true,noticeVersion:NOTICE_VERSION},files:[{name:'scan.pdf',type:'application/pdf',size:input.length,sha256:hash(input)}],options:{languages:['eng'],deskew:false,rotate:false}};
const inputPath=owner+'/'+job+'/input/0.pdf',outputPath=owner+'/'+job+'/output/result.pdf',inputUrl=project+'/storage/v1/object/sign/docflow-processing/'+inputPath+'?token=input',outputUrl=project+'/storage/v1/object/upload/sign/docflow-processing/'+outputPath+'?token=output';
const meta={name:'result.pdf',type:'application/pdf',size:output.length,sha256:hash(output),pages:1};
function setup(options:{rejectClaim?:boolean;cancel?:boolean;badInput?:boolean;badOutput?:boolean;badManifest?:boolean;exitCode?:number;stopFails?:boolean}={}){
  const calls:{url:string;method:string;body:unknown}[]=[],written:{path:string;content:Uint8Array}[]=[],pending:Promise<unknown>[]=[],created:VMOptions[]=[];let stopped=0,runs=0,opened='';
  const vm:WorkerVM={writeFiles:async files=>{written.push(...files);},mkdir:async()=>{},run:async()=>{runs++;return {exitCode:options.exitCode??0};},stop:async()=>{stopped++;if(options.stopFails)throw Error('stop failed');},readFile:async path=>{
    const bytes=path.endsWith('engine-manifest.json')?new TextEncoder().encode(JSON.stringify({sourceSha256:options.badManifest?'9'.repeat(64):'1'.repeat(64),requirementsSha256:'2'.repeat(64)})):path.endsWith('result.json')?new TextEncoder().encode(JSON.stringify({output:meta,details:{languages:['eng']},processingMs:10})):options.badOutput?new TextEncoder().encode('not a PDF result....'):output;
    return new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});
  }};
  const fetcher:typeof fetch=async(resource,init={})=>{
    const url=String(resource),body=typeof init.body==='string'?JSON.parse(init.body):init.body;calls.push({url,method:init.method??'GET',body});
    if(url===broker+'/worker/jobs/'+job+'/claim')return options.rejectClaim?Response.json({error:{code:'claim_rejected',message:'Already claimed'}},{status:409}):Response.json({id:job,ownerId:owner,attempt:1,vmName:name,request,inputPath,outputPath,inputUrl,outputUrl,leaseUntil:'2026-10-30T12:08:30Z',expiresAt:'2026-10-30T12:30:00Z'});
    if(url===broker+'/worker/jobs/'+job+'/attach')return Response.json({cancel:options.cancel===true});
    if(url===broker+'/worker/jobs/'+job+'/finish')return Response.json({job:{state:options.cancel?'cancelled':(body as Record<string,unknown>).outcome}});
    if(url===broker+'/worker/jobs/'+job+'/cancel-claim')return Response.json({vmName:name,attempt:1});
    if(url===broker+'/worker/jobs/'+job+'/cancelled')return Response.json({job:{state:'cancelled'}});
    if(url===inputUrl)return new Response(options.badInput?new TextEncoder().encode('bad input'):input,{headers:{'content-type':'application/pdf'}});
    if(url===outputUrl&&init.method==='PUT')return Response.json({Key:'docflow-processing/'+outputPath});
    throw Error('Unexpected request '+url);
  };
  const worker=createWorker({projectUrl:project,brokerUrl:broker,snapshotId:'snap_verified_engine',engineSourceHash:'1'.repeat(64),requirementsHash:'2'.repeat(64)}, {fetch:fetcher,createVM:async settings=>{created.push(settings);return vm;},openVM:async vmName=>{opened=vmName;return vm;},waitUntil:promise=>{pending.push(promise);},now:()=>Date.parse('2026-10-30T12:05:00Z')});
  const run=(kind='process',extra:Record<string,unknown>={})=>worker[kind==='process'?'process':'cancel'](new Request('https://worker.vercel.app/api/'+kind,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({job,...(kind==='process'?{claim:secret}:{cancelClaim:secret}),...extra})}));
  return {run,calls,written,created,pending,get stopped(){return stopped;},get runs(){return runs;},get opened(){return opened;}};
}
it('consumes the broker claim before allocating any VM and rejects duplicate starts',async()=>{
  const state=setup({rejectClaim:true});expect((await state.run()).status).toBe(409);expect(state.created).toHaveLength(0);expect(state.pending).toHaveLength(0);
});
it('verifies input, runs only the fixed offline engine, stops and publishes measured output without VM credentials',async()=>{
  const state=setup();expect((await state.run()).status).toBe(202);await Promise.all(state.pending);expect(state.created).toHaveLength(1);expect(state.created[0]).toMatchObject({name,persistent:false,networkPolicy:'deny-all',snapshotId:'snap_verified_engine',vcpus:1});expect(JSON.stringify(state.created[0])).not.toContain('claim');expect(state.stopped).toBe(1);expect(state.runs).toBe(1);expect(state.written.map(file=>file.path)).toEqual(['/vercel/sandbox/job/input.pdf','/vercel/sandbox/job/request.json']);expect(state.written.map(file=>new TextDecoder().decode(file.content)).join('')).not.toContain(secret);expect(state.calls.find(call=>call.url===outputUrl)?.body).toEqual(output);expect(state.calls.find(call=>call.url.endsWith('/finish'))?.body).toMatchObject({claim:secret,attempt:1,outcome:'completed',output:meta});
});
it('rejects changed input before creating a VM',async()=>{
  const state=setup({badInput:true});await state.run();await Promise.all(state.pending);expect(state.created).toHaveLength(0);expect(state.calls.find(call=>call.url.endsWith('/finish'))?.body).toMatchObject({outcome:'failed',errorCode:'unsupported_input'});
});
it('verifies the pinned snapshot manifest before writing a document into the VM',async()=>{
  const state=setup({badManifest:true});await state.run();await Promise.all(state.pending);expect(state.written).toHaveLength(0);expect(state.runs).toBe(0);expect(state.stopped).toBe(1);expect(state.calls.some(call=>call.method==='PUT')).toBe(false);
});
it('stops a VM whose attach races with cancellation without running or publishing',async()=>{
  const state=setup({cancel:true});await state.run();await Promise.all(state.pending);expect(state.runs).toBe(0);expect(state.stopped).toBe(1);expect(state.calls.some(call=>call.method==='PUT')).toBe(false);expect(state.calls.find(call=>call.url.endsWith('/finish'))?.body).toMatchObject({outcome:'failed'});
});
it('never uploads malformed output or a failed engine result',async()=>{
  for(const options of [{badOutput:true},{exitCode:2}]){const state=setup(options);await state.run();await Promise.all(state.pending);expect(state.stopped).toBe(1);expect(state.calls.some(call=>call.method==='PUT')).toBe(false);expect(state.calls.find(call=>call.url.endsWith('/finish'))?.body).toMatchObject({outcome:'failed'});}
});
it('does not publish success when stopping the VM fails',async()=>{
  const state=setup({stopFails:true});await state.run();await Promise.all(state.pending);expect(state.calls.some(call=>call.method==='PUT')).toBe(false);expect(state.calls.find(call=>call.url.endsWith('/finish'))?.body).toMatchObject({outcome:'failed',errorCode:'worker_error'});
});
it('resolves cancellation through the broker before opening/stopping only the expected VM',async()=>{
  const state=setup();expect((await state.run('cancel')).status).toBe(200);expect(state.opened).toBe(name);expect(state.stopped).toBe(1);expect(state.created).toHaveLength(0);expect((await state.run('cancel',{vmName:'someone-else'})).status).toBe(400);
});
