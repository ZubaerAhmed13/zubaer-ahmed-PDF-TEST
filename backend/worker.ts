import {LIMITS,parseCreateJobRequest,validateOutput,validateStorageUrl,type CreateJobRequest} from './contracts.ts';
import {TransportError,readBytes,readJson,record,sha256,uuid} from './http.ts';

export interface VMOptions{name:string;snapshotId:string;vcpus:1;persistent:false;networkPolicy:'deny-all';timeout:number;signal:AbortSignal}
export interface WorkerVM{
  mkdir(path:string):Promise<void>;
  writeFiles(files:{path:string;content:Uint8Array}[]):Promise<void>;
  readFile(path:string):Promise<ReadableStream<Uint8Array>|null>;
  run(timeout:number):Promise<{exitCode:number}>;
  stop():Promise<void>;
}
export interface WorkerConfig{projectUrl:string;brokerUrl:string;snapshotId:string;engineSourceHash:string;requirementsHash:string}
interface Dependencies{fetch:typeof fetch;createVM:(options:VMOptions)=>Promise<WorkerVM>;openVM:(name:string)=>Promise<Pick<WorkerVM,'stop'>>;waitUntil:(work:Promise<unknown>)=>void;now?:()=>number}
interface Claim{id:string;ownerId:string;attempt:number;vmName:string;request:CreateJobRequest;inputPath:string;outputPath:string;inputUrl:string;outputUrl:string;expiresAt:string;leaseUntil:string}

export function createWorker(config:WorkerConfig,deps:Dependencies){
  const project=new URL(config.projectUrl),broker=new URL(config.brokerUrl),now=deps.now??Date.now;
  if(project.protocol!=='https:'||project.pathname!=='/'||project.search||project.hash||project.username||project.password||broker.origin!==project.origin||broker.pathname!=='/functions/v1/docflow-processing'||broker.search||broker.hash||!/^[a-zA-Z0-9_-]{8,128}$/.test(config.snapshotId)||![config.engineSourceHash,config.requirementsHash].every(value=>/^[a-f\d]{64}$/.test(value)))throw Error('Invalid fixed worker configuration');
  async function call(job:string,kind:string,payload:unknown):Promise<Record<string,unknown>>{
    const response=await deps.fetch(broker.href+'/worker/jobs/'+job+'/'+kind,{method:'POST',redirect:'error',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)}),data=record(await readJson(response,32768));
    if(!response.ok)throw new TransportError(response.status,'claim_rejected','The broker rejected this worker request.');return data;
  }
  function parseClaim(data:Record<string,unknown>,job:string):Claim{
    let request:CreateJobRequest;try{request=parseCreateJobRequest(data.request);}catch{throw new TransportError(502,'invalid_claim','The broker returned an invalid processing request.');}
    if(data.id!==job||!uuid(data.ownerId)||!Number.isSafeInteger(data.attempt)||Number(data.attempt)<1||!Number.isFinite(Date.parse(String(data.expiresAt)))||!Number.isFinite(Date.parse(String(data.leaseUntil))))throw new TransportError(502,'invalid_claim','The broker returned an invalid job claim.');
    const root=data.ownerId+'/'+job+'/',inputPath=root+'input/0.'+request.files[0].name.split('.').pop()!.toLowerCase(),outputPath=root+'output/result.pdf',vmName='df-'+job+'-'+data.attempt;
    if(data.vmName!==vmName||data.inputPath!==inputPath||data.outputPath!==outputPath)throw new TransportError(502,'invalid_claim','The worker claim has invalid paths.');
    return {...data,request,inputUrl:validateStorageUrl(data.inputUrl,project.origin,'docflow-processing/'+inputPath,'download'),outputUrl:validateStorageUrl(data.outputUrl,project.origin,'docflow-processing/'+outputPath,'upload')} as unknown as Claim;
  }
  async function vmBytes(vm:WorkerVM,path:string,maximum:number):Promise<Uint8Array>{
    const body=await vm.readFile(path);if(!body)throw new TransportError(422,'worker_error','The engine did not produce a required file.');return readBytes({body,headers:new Headers()},maximum);
  }
  async function processClaim(claim:Claim,secret:string):Promise<void>{
    let vm:WorkerVM|undefined;let errorCode='worker_error';
    const deadline=Math.min(now()+LIMITS.processingMs,Date.parse(claim.leaseUntil)-10000,Date.parse(claim.expiresAt));
    const remaining=()=>{const value=deadline-now();if(value<=0){errorCode='deadline';throw new TransportError(408,'deadline','Processing exceeded its deadline.');}return value;};
    try{
      const response=await deps.fetch(claim.inputUrl,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(Math.min(15000,remaining()))});
      if(!response.ok)throw new TransportError(422,'unsupported_input','The uploaded input is not available.');
      const bytes=await readBytes(response,LIMITS.inputBytes),file=claim.request.files[0],pdf=claim.request.operation!=='office-to-pdf';
      if(bytes.length!==file.size||await sha256(bytes)!==file.sha256||(pdf?new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-':bytes[0]!==0x50||bytes[1]!==0x4b)){errorCode='unsupported_input';throw new TransportError(422,'unsupported_input','The input does not match its declaration.');}
      vm=await deps.createVM({name:claim.vmName,snapshotId:config.snapshotId,vcpus:1,persistent:false,networkPolicy:'deny-all',timeout:Math.max(1,remaining()-15000),signal:AbortSignal.timeout(Math.min(30000,remaining()))});
      const manifest=record(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await vmBytes(vm,'/vercel/sandbox/engine-manifest.json',16384))));
      if(manifest.sourceSha256!==config.engineSourceHash||manifest.requirementsSha256!==config.requirementsHash)throw new TransportError(503,'worker_error','The processing image does not match its verified source.');
      const attached=await call(claim.id,'attach',{claim:secret,attempt:claim.attempt});
      if(attached.cancel===true)throw new TransportError(409,'cancelled','This processing job was cancelled.');
      const directory='/vercel/sandbox/job',extension=file.name.split('.').pop()!.toLowerCase();await vm.mkdir(directory);
      await vm.writeFiles([{path:directory+'/input.'+extension,content:bytes},{path:directory+'/request.json',content:new TextEncoder().encode(JSON.stringify(claim.request))}]);
      const command=await vm.run(Math.max(1,remaining()-15000));
      if(command.exitCode!==0){errorCode=command.exitCode===2?'unsupported_input':'engine_error';throw new TransportError(422,errorCode,'The isolated engine could not process this document.');}
      const info=record(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await vmBytes(vm,directory+'/result.json',16384)))),output=validateOutput(info.output),result=await vmBytes(vm,directory+'/result.pdf',LIMITS.outputBytes);
      if(result.length!==output.size||new TextDecoder().decode(result.subarray(0,5))!=='%PDF-'||await sha256(result)!==output.sha256)throw new TransportError(422,'worker_error','The output failed transport verification.');
      remaining();await vm.stop();vm=undefined;
      const uploaded=await deps.fetch(claim.outputUrl,{method:'PUT',redirect:'error',cache:'no-store',headers:{'content-type':'application/pdf','cache-control':'max-age=0'},body:result as BodyInit,signal:AbortSignal.timeout(Math.min(15000,remaining()))});
      if(!uploaded.ok)throw new TransportError(503,'worker_error','The verified output could not be stored.');
      await call(claim.id,'finish',{claim:secret,attempt:claim.attempt,outcome:'completed',output,details:{processingMs:typeof info.processingMs==='number'?info.processingMs:null,engine:config.engineSourceHash,operation:info.details??null}});
    }catch(error){
      if(vm){try{await vm.stop();vm=undefined;}catch{/* The nonpersistent VM also has a fixed automatic timeout. */}}
      if(error instanceof TransportError&&['unsupported_input','deadline','engine_error'].includes(error.code))errorCode=error.code;
      try{await call(claim.id,'finish',{claim:secret,attempt:claim.attempt,outcome:'failed',errorCode});}catch{/* Cancellation, expiry and the durable maintenance path win over obsolete workers. */}
    }finally{if(vm)await vm.stop().catch(()=>{});}
  }
  async function requestBody(request:Request,cancel:boolean){
    if(request.method!=='POST')throw new TransportError(405,'method_not_allowed','Use POST for this route.');
    if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')??''))throw new TransportError(415,'invalid_request','Send JSON request data.');
    const data=record(await readJson(request,2048)),key=cancel?'cancelClaim':'claim';
    if(Object.keys(data).some(name=>name!=='job'&&name!==key)||!uuid(data.job)||typeof data[key]!=='string'||!/^[a-f\d]{64}$/.test(String(data[key])))throw new TransportError(400,'invalid_request','Invalid job claim.');return {job:data.job,secret:String(data[key])};
  }
  const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
  const guarded=(fn:(request:Request)=>Promise<Response>)=>async(request:Request)=>{try{return await fn(request);}catch(error){return error instanceof TransportError?json({error:{code:error.code,message:error.message}},error.status):json({error:{code:'worker_unavailable',message:'The processing worker is temporarily unavailable.'}},503);}};
  return {
    process:guarded(async request=>{const data=await requestBody(request,false),claim=parseClaim(await call(data.job,'claim',{claim:data.secret}),data.job);deps.waitUntil(processClaim(claim,data.secret));return json({accepted:true},202);}),
    cancel:guarded(async request=>{const data=await requestBody(request,true),state=await call(data.job,'cancel-claim',{cancelClaim:data.secret});
      if(!Number.isSafeInteger(state.attempt)||Number(state.attempt)<1||state.vmName!==null&&state.vmName!=='df-'+data.job+'-'+state.attempt)throw new TransportError(502,'invalid_claim','Invalid cancellation target.');
      if(state.vmName!==null){const vm=await deps.openVM(String(state.vmName));await vm.stop();}
      await call(data.job,'cancelled',{cancelClaim:data.secret});return json({cancelled:true});}),
  };
}
