import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {startRemoteProcessing} from '../src/v2/remoteProcessing';

const project='https://project.supabase.co',owner='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001';
const bytes=new TextEncoder().encode('%PDF-1.7\nsynthetic result\n');
const meta={name:'result.pdf',type:'application/pdf',size:bytes.length,pages:1,sha256:createHash('sha256').update(bytes).digest('hex')};
const input=new File([bytes],'scan.pdf',{type:'application/pdf'}),settings={operation:'ocr' as const,options:{languages:['eng' as const],deskew:false,rotate:false}};
function setup(change?:(url:string,init:RequestInit)=>Promise<Response|undefined>|Response|undefined){
  const calls:{url:string;init:RequestInit}[]=[];let state='queued';const notes:string[]=[];
  const upload=project+'/storage/v1/object/upload/sign/docflow-processing/'+owner+'/'+id+'/input/0.pdf?token=input',download=project+'/storage/v1/object/sign/docflow-processing/'+owner+'/'+id+'/output/result.pdf?token=output';
  const fetcher:typeof fetch=async(resource,init={})=>{const url=String(resource);calls.push({url,init});const replacement=await change?.(url,init);if(replacement)return replacement;
    if(url.endsWith('/jobs'))return Response.json({job:{id,state,phase:'awaiting_upload'},upload:{url:upload,method:'PUT',headers:{'content-type':'application/pdf'}}});
    if(url===upload)return Response.json({Key:'input'});
    if(url.endsWith('/start')){state='completed';return Response.json({job:{id,state,phase:'done',output:meta}},{status:202});}
    if(url.endsWith('/cancel')){state='cancelled';return Response.json({job:{id,state,phase:'done'},cleanupPending:false});}
    if(url.endsWith('/downloads'))return Response.json({output:meta,url:download,expiresAt:new Date(Date.now()+60000).toISOString()});
    if(url===download)return new Response(bytes);
    if(url.endsWith('/jobs/'+id))return Response.json({job:{id,state,phase:state==='completed'?'done':'processing',output:state==='completed'?meta:null}});
    throw Error('Unexpected route');
  };
  const start=(consent=true)=>startRemoteProcessing(input,settings,consent,{projectUrl:project,publishableKey:'sb_publishable_test'},{fetch:fetcher,identity:async()=>({id:owner,accessToken:'user-token'}),sleep:async()=>{},progress:note=>notes.push(note)});
  return {start,calls,notes,upload,download};
}
it('requires explicit upload consent before reading a file or contacting any service',async()=>{
  const s=setup();await expect(s.start(false).result).rejects.toThrow(/consent/i);expect(s.calls).toHaveLength(0);
});
it('uploads only to the scoped URL without auth headers and verifies the downloaded bytes',async()=>{
  const s=setup(),running=s.start(),result=await running.result;
  expect(result.outputs[0]?.buffer).toEqual(bytes.buffer);expect(result.outputs[0]?.type).toBe('application/pdf');
  const sent=s.calls.find(call=>call.url.endsWith('/jobs'))!;const payload=JSON.parse(String(sent.init.body));expect(payload.owner).toBeUndefined();expect(payload.files[0].sha256).toBe(meta.sha256);
  for(const call of s.calls.filter(call=>call.url.includes('/storage/'))){expect(new Headers(call.init.headers).has('authorization')).toBe(false);expect(new Headers(call.init.headers).has('apikey')).toBe(false);expect(call.init.redirect).toBe('error');}
  expect(s.notes).toContain('Downloading verified PDF…');expect(running.jobId()).toBe(id);
});
it('rejects a forged upload URL before sending document bytes',async()=>{
  const s=setup(url=>url.endsWith('/jobs')?Response.json({job:{id,state:'queued',phase:'awaiting_upload'},upload:{url:'https://other.example/steal?token=x'}}):undefined);
  await expect(s.start().result).rejects.toThrow(/file link|scope/i);expect(s.calls.some(call=>call.init.method==='PUT')).toBe(false);
});
it('rejects changed downloaded output instead of returning it as a success',async()=>{
  const s=setup(url=>url.includes('/object/sign/')?new Response('%PDF-wrong'):undefined);await expect(s.start().result).rejects.toThrow(/verification|match/i);
});
it('waits for a pending creation then cancels its actual job without uploading',async()=>{
  let release:()=>void=()=>{};let entered:()=>void=()=>{};const created=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const s=setup(async url=>{if(url.endsWith('/jobs')){entered();await gate;}return undefined;});
  const running=s.start();const failure=running.result.catch(error=>error);await created;const cancelled=running.cancel();expect(s.notes).toContain('Requesting server cancellation…');release();
  expect((await cancelled).state).toBe('cancelled');expect((await failure).name).toBe('AbortError');expect(s.calls.some(call=>call.init.method==='PUT')).toBe(false);
});
it('does not claim cancellation succeeded when the server cannot acknowledge it',async()=>{
  let uploaded:()=>void=()=>{};const uploadStarted=new Promise<void>(resolve=>{uploaded=resolve;});
  const s=setup(async(url,init)=>{if(init.method==='PUT'){uploaded();await new Promise((_resolve,reject)=>init.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));}if(url.endsWith('/cancel'))return Response.json({error:{code:'service_unavailable',message:'Unavailable'}},{status:503});return undefined;});
  const running=s.start();const failure=running.result.catch(error=>error);await uploadStarted;await expect(running.cancel()).rejects.toThrow(/not confirmed/i);expect((await failure).message).toMatch(/not confirmed/i);expect(s.notes).not.toContain('Server processing cancelled.');
});
it('cancels a known queued job after an upload failure so a retry does not strand the owner slot',async()=>{
  const s=setup((_url,init)=>init.method==='PUT'?Response.json({error:'temporary storage failure'},{status:503}):undefined);
  await expect(s.start().result).rejects.toThrow(/upload did not finish/i);expect(s.calls.some(call=>call.url.endsWith('/cancel'))).toBe(true);
});
it('recovers an uncertain create with the same idempotency key',async()=>{
  let creates=0;const s=setup(url=>{if(url.endsWith('/jobs')&&creates++===0)throw Error('response lost');return undefined;});await s.start().result;
  const payloads=s.calls.filter(call=>call.url.endsWith('/jobs')).map(call=>JSON.parse(String(call.init.body)));expect(payloads).toHaveLength(2);expect(payloads[0].idempotencyKey).toBe(payloads[1].idempotencyKey);
});
it('recovers the same job when a successful create response body resets after its headers',async()=>{
  let creates=0;const s=setup(url=>url.endsWith('/jobs')&&creates++===0?new Response(new ReadableStream({start(controller){controller.error(new Error('connection reset after headers'));}}),{status:201,headers:{'content-type':'application/json'}}):undefined);
  await s.start().result;const payloads=s.calls.filter(call=>call.url.endsWith('/jobs')).map(call=>JSON.parse(String(call.init.body)));expect(payloads).toHaveLength(2);expect(payloads[0].idempotencyKey).toBe(payloads[1].idempotencyKey);
});
it('allows an explicit cancellation retry after a failed acknowledgement',async()=>{
  let release:()=>void=()=>{},entered:()=>void=()=>{},attempts=0;
  const gate=new Promise<void>(r=>{release=r;}),uploading=new Promise<void>(r=>{entered=r;});
  const s=setup(async(url,init)=>{if(init.method==='PUT'){entered();await gate;throw Error('transfer stopped');}if(url.endsWith('/cancel')&&attempts++===0)return Response.json({error:{code:'unavailable'}},{status:503});});
  const operation=s.start(),failure=operation.result.catch(e=>e);await uploading;
  await expect(operation.cancel()).rejects.toThrow(/not confirmed/i);release();await failure;
  expect((await operation.cancel()).state).toBe('cancelled');expect(attempts).toBe(2);
});
it('retrieves a completed output again without creating or starting another job',async()=>{
  let downloads=0;const s=setup(url=>url.includes('/object/sign/')&&downloads++===0?new Response('',{status:503}):undefined);
  const operation=s.start();await expect(operation.result).rejects.toThrow(/download/i);
  expect((await operation.check())?.state).toBe('completed');expect((await operation.retrieve()).outputs[0]?.buffer).toEqual(bytes.buffer);
  expect(s.calls.filter(c=>c.url.endsWith('/jobs'))).toHaveLength(1);expect(s.calls.filter(c=>c.url.endsWith('/start'))).toHaveLength(1);
});
it('recovers an unknown creation with its original key and cancels without uploading',async()=>{
  let creates=0;const s=setup(url=>url.endsWith('/jobs')&&creates++<2?new Response(new ReadableStream({start(c){c.error(Error('reset'));}}),{status:201}):undefined);
  const operation=s.start();await expect(operation.result).rejects.toThrow(/incomplete/i);expect(operation.jobId()).toBeNull();
  expect((await operation.check())?.id).toBe(id);expect((await operation.cancel()).state).toBe('cancelled');
  const requests=s.calls.filter(c=>c.url.endsWith('/jobs')).map(c=>JSON.parse(String(c.init.body)));
  expect(new Set(requests.map(r=>r.idempotencyKey)).size).toBe(1);expect(s.calls.some(c=>c.init.method==='PUT'||c.url.endsWith('/start'))).toBe(false);
});
it('checks expiry before retrying a completed download',async()=>{
  let expired=false;const s=setup(url=>expired&&url.endsWith('/jobs/'+id)?Response.json({job:{id,state:'expired',phase:'expired'}}):undefined);
  const operation=s.start();await operation.result;expired=true;const count=s.calls.length;
  await expect(operation.retrieve()).rejects.toThrow(/completed|expired/i);expect(s.calls.slice(count).some(c=>c.url.endsWith('/downloads'))).toBe(false);
});
it('stops a local download on cancellation while reporting that the server completed',async()=>{
  let entered:()=>void=()=>{},release:()=>void=()=>{},signal:AbortSignal|undefined;
  const ready=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});
  const s=setup(async(url,init)=>{if(url.includes('/object/sign/')){signal=init.signal??undefined;entered();await gate;}return undefined;});
  const operation=s.start(),result=operation.result.catch(e=>e);await ready;
  try{expect((await operation.cancel()).state).toBe('completed');expect(signal?.aborted).toBe(true);}finally{release();await result;}
});
it('releases a definite pre-creation staging rejection without pretending a job exists',async()=>{
  const s=setup(url=>url.endsWith('/jobs')?Response.json({error:{code:'processing_not_ready',message:'Server document processing is not enabled yet.'}},{status:503}):undefined);
  const operation=s.start();await expect(operation.result).rejects.toThrow(/not enabled/i);expect(await operation.check()).toBeNull();expect((await operation.cancel()).state).toBe('cancelled');expect(s.calls.filter(c=>c.url.endsWith('/jobs'))).toHaveLength(1);
});
it('keeps creation uncertain when a lost first response is followed by a staging rejection',async()=>{
  let attempts=0;const s=setup(url=>{if(!url.endsWith('/jobs'))return;if(attempts++===0)throw Error('response lost');return Response.json({error:{code:'processing_not_ready',message:'Not enabled'}},{status:503});});
  const operation=s.start();await expect(operation.result).rejects.toThrow(/not enabled/i);await expect(operation.check()).rejects.toThrow(/not enabled/i);expect(s.calls.filter(c=>c.url.endsWith('/jobs'))).toHaveLength(3);
});
