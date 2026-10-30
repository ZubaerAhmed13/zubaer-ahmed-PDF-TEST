import {describe,expect,it} from 'vitest';
import {createBroker,type BrokerConfig} from '../backend/broker';
import {NOTICE_VERSION} from '../backend/contracts';
import {createHash} from 'node:crypto';

const origin='https://project.supabase.co',a='10000000-0000-4000-8000-000000000001',b='10000000-0000-4000-8000-000000000002',job='20000000-0000-4000-8000-000000000001';
const input={operation:'ocr',idempotencyKey:'30000000-0000-4000-8000-000000000001',consent:{accepted:true,noticeVersion:NOTICE_VERSION},files:[{name:'scan.pdf',type:'application/pdf',size:20,sha256:'a'.repeat(64)}],options:{languages:['eng'],deskew:false,rotate:false}};
const path=a+'/'+job+'/input/0.pdf',outputPath=a+'/'+job+'/output/result.pdf';
const metadata={name:'result.pdf',type:'application/pdf',size:20,sha256:'b'.repeat(64),pages:1};
const claimHash=createHash('sha256').update('d'.repeat(64)).digest('hex');
const row=()=>({id:job,owner_id:a,state:'queued',phase:'awaiting_upload',attempt:0,operation:'ocr',request:input,input_path:path,output_path:null,output:null,details:null,error_code:null,created_at:'2026-10-30T12:00:00Z',expires_at:'2026-10-30T12:30:00Z'});
const config:BrokerConfig={projectUrl:origin,serviceKey:'server-only-key',workerUrl:'https://worker.vercel.app',workerBypass:'server-only-bypass',cleanupHash:'c'.repeat(64),enabled:true,cleanupReady:true,allowedOwners:[],allowedOrigins:['https://docflow.example']};
function setup(overrides:Partial<BrokerConfig>={},change?:(url:string,init:RequestInit,body:Record<string,unknown>)=>Response|undefined){
  let record:Record<string,unknown>=row();const calls:{url:string;method:string;body:Record<string,unknown>;headers:Headers}[]=[];
  const fetcher:typeof fetch=async(resource,init={})=>{
    const url=String(resource),headers=new Headers(init.headers),body=typeof init.body==='string'?JSON.parse(init.body):{};
    calls.push({url,method:init.method??'GET',body,headers});const replacement=change?.(url,init,body);if(replacement)return replacement;
    if(url===origin+'/rest/v1/rpc/docflow_cleanup_authorize')return Response.json(true);
    if(url===origin+'/auth/v1/user'){const token=headers.get('authorization');return token==='Bearer owner-a'?Response.json({id:a,role:'authenticated'}):token==='Bearer owner-b'?Response.json({id:b,role:'authenticated'}):Response.json({msg:'invalid'}, {status:401});}
    if(url===origin+'/rest/v1/rpc/docflow_job_action'){
      const payload=body.p_payload as Record<string,unknown>,action=body.p_action;
      if(['read','start','cancel'].includes(String(action))&&payload.owner!==record.owner_id)return Response.json({message:'Job not found'},{status:400});
      if(action==='create'){expect(payload.owner).toBe(a);expect(payload.request).toMatchObject({operation:'ocr'});expect(payload.requestHash).toMatch(/^[a-f0-9]{64}$/);return Response.json(record);}
      if(action==='read')return Response.json(record);
      if(action==='start'){record={...record,phase:'runnable'};return Response.json({dispatch:true,job:record});}
      if(action==='cancel'){record={...record,state:'cancelled',phase:'done'};return Response.json({dispatch:false,job:record});}
      if(action==='claim'){if(payload.claimHash!==claimHash)return Response.json({message:'Claim rejected'},{status:400});record={...record,state:'running',phase:'processing',attempt:1,lease_until:'2026-10-30T12:08:30Z'};return Response.json(record);}
      if(action==='attach'){if(payload.claimHash!==claimHash||payload.attempt!==1)return Response.json({message:'Worker lease rejected'},{status:400});return Response.json({cancel:false});}
      if(action==='finish'){record={...record,state:payload.outcome==='completed'?'completed':'failed',phase:'done',output:payload.outcome==='completed'?payload.output:null,output_path:payload.outcome==='completed'?outputPath:null};return Response.json(record);}
      throw Error('Unexpected action '+String(action));
    }
    if(url===origin+'/rest/v1/docflow_jobs?id=eq.'+job+'&select=*')return Response.json([record]);
    if(url===origin+'/storage/v1/object/upload/sign/docflow-processing/'+path)return Response.json({url:'/object/upload/sign/docflow-processing/'+path+'?token=upload-token'});
    if(url===origin+'/storage/v1/object/upload/sign/docflow-processing/'+outputPath)return Response.json({url:'/object/upload/sign/docflow-processing/'+outputPath+'?token=output-token'});
    if(url===origin+'/storage/v1/object/sign/docflow-processing/'+path)return Response.json({signedURL:'/object/sign/docflow-processing/'+path+'?token=input-token'});
    if(url===origin+'/storage/v1/object/sign/docflow-processing/'+outputPath)return Response.json({signedURL:'/object/sign/docflow-processing/'+outputPath+'?token=download-token'});
    if(url===origin+'/storage/v1/object/docflow-processing/'+path&&init.method==='HEAD')return new Response(null,{headers:{'content-length':'20','content-type':'application/pdf'}});
    if(url===origin+'/storage/v1/object/docflow-processing'&&init.method==='DELETE')return Response.json([]);
    if(url==='https://worker.vercel.app/api/process')return Response.json({accepted:true},{status:202});
    throw Error('Unexpected upstream '+url);
  };
  const handler=createBroker({...config,...overrides},{fetch:fetcher,now:()=>Date.parse('2026-10-30T12:05:00Z'),token:()=> 'e'.repeat(64)});
  const request=(suffix:string,method='GET',body?:unknown,owner='owner-a',requestOrigin?:string)=>handler(new Request(origin+'/functions/v1/docflow-processing/api/v1'+suffix,{method,headers:{...(owner?{authorization:'Bearer '+owner}:{}),...(requestOrigin?{origin:requestOrigin}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  return {request,calls,setRow:(value:Record<string,unknown>)=>{record={...record,...value};},handler};
}

describe('processing broker boundary',()=>{
  it('requires authenticated ownership before creating or signing an upload',async()=>{
    const {request,calls}=setup();expect((await request('/jobs','POST',input,'')).status).toBe(401);expect(calls).toHaveLength(0);
    const result=await request('/jobs','POST',input);expect(result.status).toBe(201);const body=await result.json();expect(body.job.id).toBe(job);expect(body.upload.url).toBe(origin+'/storage/v1/object/upload/sign/docflow-processing/'+path+'?token=upload-token');expect(JSON.stringify(body)).not.toContain('server-only');
    expect(calls.filter(call=>call.url.includes('/storage/')).every(call=>call.headers.get('authorization')==='Bearer server-only-key')).toBe(true);
  });
  it('does not accept an owner supplied by the client or unknown request fields',async()=>{
    const {request,calls}=setup();expect((await request('/jobs','POST',{...input,owner:b})).status).toBe(400);expect(calls.some(call=>call.url.includes('/rpc/'))).toBe(false);
  });
  it('keeps another owner from reading, starting, cancelling or downloading a job',async()=>{
    const {request,calls}=setup();for(const [suffix,method] of [['','GET'],['/start','POST'],['/cancel','POST'],['/downloads','GET']])expect((await request('/jobs/'+job+suffix,method,method==='POST'?{}:undefined,'owner-b')).status).toBe(404);expect(calls.some(call=>call.url.includes('/storage/')||call.url.startsWith('https://worker.'))).toBe(false);
  });
  it('checks the uploaded object before dispatch and keeps the opaque worker claim out of the response',async()=>{
    const {request,calls}=setup();const response=await request('/jobs/'+job+'/start','POST',{});expect(response.status).toBe(202);expect(JSON.stringify(await response.json())).not.toContain('e'.repeat(64));const dispatch=calls.find(call=>call.url.endsWith('/api/process'))!;expect(dispatch.body).toEqual({job,claim:'e'.repeat(64)});expect(dispatch.headers.get('x-vercel-protection-bypass')).toBe('server-only-bypass');expect(calls.findIndex(call=>call.method==='HEAD')).toBeLessThan(calls.indexOf(dispatch));
  });
  it('rejects missing uploads and does not spend a processing claim',async()=>{
    const {request,calls}=setup({},(_url,init)=>init.method==='HEAD'?new Response(null,{status:404}):undefined);expect((await request('/jobs/'+job+'/start','POST',{})).status).toBe(409);expect(calls.some(call=>call.body.p_action==='start'||call.url.endsWith('/api/process'))).toBe(false);
  });
  it('signs only completed output for sixty seconds and omits database control fields',async()=>{
    const {request,setRow,calls}=setup();setRow({state:'completed',phase:'done',output:metadata,output_path:outputPath});const response=await request('/jobs/'+job+'/downloads');expect(response.status).toBe(200);const value=await response.json();expect(value.output).toEqual(metadata);expect(value.url).toBe(origin+'/storage/v1/object/sign/docflow-processing/'+outputPath+'?token=download-token');expect(calls.at(-1)?.body).toEqual({expiresIn:60});expect(JSON.stringify(value)).not.toContain('owner_id');
    setRow({state:'expired',output:null,output_path:null});expect((await request('/jobs/'+job+'/downloads')).status).toBe(410);
  });
  it('rejects out-of-scope storage URLs even if returned by the upstream signer',async()=>{
    const {request}=setup({},url=>url.includes('/upload/sign/')?Response.json({url:'https://evil.example/steal?token=x'}):undefined);expect((await request('/jobs','POST',input)).status).toBe(502);
  });
  it('allows only configured browser origins and bounds the body before a job write',async()=>{
    const {request,handler,calls}=setup();expect((await request('/jobs','POST',input,'owner-a','https://evil.example')).status).toBe(403);
    const response=await handler(new Request(origin+'/functions/v1/docflow-processing/api/v1/jobs',{method:'POST',headers:{authorization:'Bearer owner-a','content-type':'application/json'},body:' '.repeat(17000)}));expect(response.status).toBe(413);expect(calls.some(call=>call.url.includes('/rpc/'))).toBe(false);
  });
  it('keeps normal uploads disabled while allowing only named synthetic acceptance owners',async()=>{
    const closed=setup({enabled:false});expect((await closed.request('/jobs','POST',input)).status).toBe(503);const staged=setup({enabled:false,allowedOwners:[a]});expect((await staged.request('/jobs','POST',input)).status).toBe(201);
  });
  it('does not issue upload credentials while durable cleanup is unhealthy',async()=>{
    const {request,calls}=setup({cleanupReady:false});expect((await request('/jobs','POST',input)).status).toBe(503);expect(calls.some(call=>call.url.includes('/storage/'))).toBe(false);
  });
});

describe('broker worker callbacks',()=>{
  function worker(handler:ReturnType<typeof createBroker>,action:string,body:unknown){return handler(new Request(origin+'/functions/v1/docflow-processing/worker/jobs/'+job+'/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));}
  it('signs exact input/output paths only after a valid job claim is consumed',async()=>{
    const {handler,calls}=setup();expect((await worker(handler,'claim',{claim:'f'.repeat(64)})).status).toBe(409);expect(calls.some(call=>call.url.includes('/storage/'))).toBe(false);
    const response=await worker(handler,'claim',{claim:'d'.repeat(64)});expect(response.status).toBe(200);const value=await response.json();expect(value).toMatchObject({id:job,attempt:1,vmName:'df-'+job+'-1',inputPath:path,outputPath});expect(value.inputUrl).toBe(origin+'/storage/v1/object/sign/docflow-processing/'+path+'?token=input-token');expect(value.outputUrl).toBe(origin+'/storage/v1/object/upload/sign/docflow-processing/'+outputPath+'?token=output-token');expect(JSON.stringify(value)).not.toContain('server-only');
  });
  it('authorizes a worker attempt before reading output and rejects a wrong hash without completion',async()=>{
    const bytes=new TextEncoder().encode('%PDF-1.7\nhello-data\n');const {handler,calls}=setup({},(url,init)=>url===origin+'/storage/v1/object/docflow-processing/'+outputPath&&init.method==='GET'?new Response(bytes,{headers:{'content-type':'application/pdf','content-length':String(bytes.length)}}):undefined);
    expect((await worker(handler,'finish',{claim:'f'.repeat(64),attempt:1,outcome:'completed',output:metadata})).status).toBe(409);expect(calls.some(call=>call.url.endsWith(outputPath))).toBe(false);
    expect((await worker(handler,'finish',{claim:'d'.repeat(64),attempt:1,outcome:'completed',output:metadata})).status).toBe(422);expect(calls.some(call=>call.body.p_action==='finish'&&(call.body.p_payload as Record<string,unknown>).outcome==='completed')).toBe(false);
  });
  it('measures actual stored output before publishing and purges the completed input',async()=>{
    const bytes=new TextEncoder().encode('%PDF-1.7\nhello-data\n'),output={...metadata,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
    const {handler,calls}=setup({},(url,init)=>url===origin+'/storage/v1/object/docflow-processing/'+outputPath&&init.method==='GET'?new Response(bytes,{headers:{'content-type':'application/pdf','content-length':String(bytes.length)}}):undefined);
    const response=await worker(handler,'finish',{claim:'d'.repeat(64),attempt:1,outcome:'completed',output,details:{processingMs:20}});expect(response.status).toBe(200);expect((await response.json()).job.state).toBe('completed');expect(calls.find(call=>call.method==='DELETE')?.body).toEqual({prefixes:[path]});
  });
});

describe('durable physical cleanup',()=>{
  const secret='9'.repeat(64),cleanupHash=createHash('sha256').update(secret).digest('hex'),lease='40000000-0000-4000-8000-000000000001';
  function maintain(handler:ReturnType<typeof createBroker>,token=secret){return handler(new Request(origin+'/functions/v1/docflow-processing/maintenance',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:'{}'}));}
  it('authenticates maintenance without accepting an end-user or exposing object paths',async()=>{
    let claims=0;
    const {handler,calls}=setup({cleanupHash},(url)=>url.endsWith('/rpc/docflow_cleanup_claim')?Response.json({busy:false,names:claims++===0?[path,outputPath]:[],lease}):url.endsWith('/rpc/docflow_cleanup_ack')?Response.json(true):undefined);
    expect((await maintain(handler,'owner-a')).status).toBe(401);expect(calls).toHaveLength(0);
    const response=await maintain(handler);expect(response.status).toBe(200);expect(await response.json()).toEqual({deleted:2,batches:2,busy:false});
    expect(calls.find(call=>call.method==='DELETE')?.body).toEqual({prefixes:[path,outputPath]});
    expect(calls.filter(call=>call.url.endsWith('/rpc/docflow_cleanup_ack')).map(call=>call.body)).toEqual([{p_lease:lease,p_ok:true,p_deleted:2},{p_lease:lease,p_ok:true,p_deleted:0}]);
  });
  it('marks cleanup unhealthy after a Storage failure and leaves candidates for scheduled retry',async()=>{
    const {handler,calls}=setup({cleanupHash},(url,init)=>url.endsWith('/rpc/docflow_cleanup_claim')?Response.json({busy:false,names:[path],lease}):url.endsWith('/rpc/docflow_cleanup_ack')?Response.json(true):init.method==='DELETE'?Response.json({message:'temporary failure'},{status:503}):undefined);
    const response=await maintain(handler);expect(response.status).toBe(503);expect(JSON.stringify(await response.json())).not.toContain(path);
    expect(calls.find(call=>call.url.endsWith('/rpc/docflow_cleanup_ack'))?.body).toEqual({p_lease:lease,p_ok:false,p_deleted:0});
  });
  it('rejects unexpected cleanup paths before any privileged delete',async()=>{
    const {handler,calls}=setup({cleanupHash},url=>url.endsWith('/rpc/docflow_cleanup_claim')?Response.json({busy:false,names:[a+'/'+job+'/../private.pdf'],lease}):url.endsWith('/rpc/docflow_cleanup_ack')?Response.json(true):undefined);
    expect((await maintain(handler)).status).toBe(503);expect(calls.some(call=>call.method==='DELETE')).toBe(false);
    expect(calls.find(call=>call.url.endsWith('/rpc/docflow_cleanup_ack'))?.body.p_ok).toBe(false);
  });
  it('bounds each invocation and respects an active cleanup lease',async()=>{
    const bounded=setup({cleanupHash},url=>url.endsWith('/rpc/docflow_cleanup_claim')?Response.json({busy:false,names:[path],lease}):url.endsWith('/rpc/docflow_cleanup_ack')?Response.json(true):undefined);
    expect((await maintain(bounded.handler)).status).toBe(200);expect(bounded.calls.filter(call=>call.method==='DELETE')).toHaveLength(5);
    const busy=setup({cleanupHash},url=>url.endsWith('/rpc/docflow_cleanup_claim')?Response.json({busy:true,names:[],lease:null}):undefined);
    expect((await maintain(busy.handler)).status).toBe(202);expect(busy.calls).toHaveLength(2);
  });
  it('does not report healthy cleanup when its acknowledgement loses the fence',async()=>{
    const {handler}=setup({cleanupHash},url=>url.endsWith('/rpc/docflow_cleanup_claim')?Response.json({busy:false,names:[],lease}):url.endsWith('/rpc/docflow_cleanup_ack')?Response.json(false):undefined);
    expect((await maintain(handler)).status).toBe(503);
  });
  it('atomically consumes the short-lived maintenance token and rejects a replay before claiming or deleting',async()=>{
    let consumed=false;
    const {handler,calls}=setup({cleanupHash},url=>{
      if(url.endsWith('/rpc/docflow_cleanup_authorize')){const allowed=!consumed;consumed=true;return Response.json(allowed);}
      if(url.endsWith('/rpc/docflow_cleanup_claim'))return Response.json({busy:false,names:[],lease});
      if(url.endsWith('/rpc/docflow_cleanup_ack'))return Response.json(true);
    });
    expect((await maintain(handler)).status).toBe(200);expect((await maintain(handler)).status).toBe(401);
    expect(calls.filter(call=>call.url.endsWith('/rpc/docflow_cleanup_claim'))).toHaveLength(1);
  });
});
