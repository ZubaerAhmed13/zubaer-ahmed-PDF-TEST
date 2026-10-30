import {LIMITS,parseCreateJobRequest,validateOutput,validateStorageUrl,type CreateJobRequest,type OutputFile} from './contracts.ts';
import {TransportError,bearer,equalSecret,opaqueToken,readBytes,readJson,record,sha256,uuid} from './http.ts';

export interface BrokerConfig {
  projectUrl:string;serviceKey:string;workerUrl:string;workerBypass:string;cleanupHash:string;
  enabled:boolean;cleanupReady:boolean;allowedOwners:string[];allowedOrigins:string[];
}
interface Job {
  id:string;owner_id:string;state:string;phase:string;attempt:number;operation:string;
  request:unknown;input_path:string;output_path:string|null;output:unknown;details:unknown;error_code:string|null;
  created_at:string;expires_at:string;
}
interface Dependencies{fetch:typeof fetch;now?:()=>number;token?:()=>string}
const bucket='docflow-processing';
const terminal=new Set(['cancelled','completed','failed','expired']);
function checkedJob(value:unknown,owner?:string):Job{
  const job=record(value);
  if(!uuid(job.id)||!uuid(job.owner_id)||owner!==undefined&&job.owner_id!==owner||!['queued','running','cancelling',...terminal].includes(String(job.state))||!['awaiting_upload','runnable','processing','done'].includes(String(job.phase))||!Number.isSafeInteger(job.attempt)||Number(job.attempt)<0||!Number.isFinite(Date.parse(String(job.expires_at))))throw new TransportError(502,'upstream_error','The processing service returned an invalid job.');
  return job as unknown as Job;
}
function publicJob(job:Job){return {id:job.id,operation:job.operation,state:job.state,phase:job.phase,attempt:job.attempt,createdAt:job.created_at,expiresAt:job.expires_at,...(job.state==='completed'?{output:validateOutput(job.output)}:{}),...(job.error_code?{errorCode:['unsupported_input','engine_error','deadline','worker_error','job_expired'].includes(job.error_code)?job.error_code:'worker_error'}:{})};}
function rpcFailure(message:string):TransportError{
  if(message==='Job not found')return new TransportError(404,'job_not_found','This job is unavailable.');
  if(/quota|limit reached/i.test(message))return new TransportError(429,'processing_limit','The processing limit has been reached. Try again later.');
  if(/expired/i.test(message))return new TransportError(410,'job_expired','This job has expired. Select the original file again.');
  if(/Idempotency conflict/i.test(message))return new TransportError(409,'request_conflict','This request identifier belongs to different settings.');
  if(/claim rejected|lease rejected|publication rejected|no longer active/i.test(message))return new TransportError(409,'claim_rejected','The job no longer accepts this worker attempt.');
  return new TransportError(503,'service_unavailable','The processing service is temporarily unavailable.');
}

export function createBroker(config:BrokerConfig,deps:Dependencies){
  const project=new URL(config.projectUrl),worker=new URL(config.workerUrl),now=deps.now??Date.now,token=deps.token??opaqueToken;
  if(project.protocol!=='https:'||project.pathname!=='/'||project.username||project.password||project.search||project.hash||worker.protocol!=='https:'||worker.pathname!=='/'||worker.username||worker.password||worker.search||worker.hash)throw Error('Invalid fixed processing origins');
  const serviceHeaders={apikey:config.serviceKey,authorization:'Bearer '+config.serviceKey,'content-type':'application/json'};
  async function upstream(url:string,init:RequestInit={}):Promise<Response>{
    try{return await deps.fetch(url,{...init,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});}catch{throw new TransportError(503,'service_unavailable','The processing service could not be reached.');}
  }
  async function service(path:string,method:string,payload?:unknown):Promise<unknown>{
    const response=await upstream(project.origin+path,{method,headers:serviceHeaders,...(payload===undefined?{}:{body:JSON.stringify(payload)})});
    const data=await readJson(response,65536);
    if(!response.ok)throw rpcFailure(typeof record(data).message==='string'?String(record(data).message):'');return data;
  }
  const action=(name:string,payload:Record<string,unknown>)=>service('/rest/v1/rpc/docflow_job_action','POST',{p_action:name,p_payload:payload});
  async function owner(request:Request):Promise<string>{
    const response=await upstream(project.origin+'/auth/v1/user',{headers:{apikey:config.serviceKey,authorization:'Bearer '+bearer(request)}});
    if(!response.ok){if(response.status>=500)throw new TransportError(503,'service_unavailable','Authentication is temporarily unavailable.');throw new TransportError(401,'authentication_required','Sign in to continue.');}
    const user=record(await readJson(response,65536));if(!uuid(user.id)||user.role!=='authenticated'||user.is_anonymous===true)throw new TransportError(401,'authentication_required','Sign in with your DocFlow account.');return user.id;
  }
  function paths(job:Job):{input:string;output:string;request:CreateJobRequest}{
    let request:CreateJobRequest;try{request=parseCreateJobRequest(job.request);}catch{throw new TransportError(502,'upstream_error','The saved processing request is invalid.');}
    const input=job.owner_id+'/'+job.id+'/input/0.'+request.files[0].name.split('.').pop()!.toLowerCase(),output=job.owner_id+'/'+job.id+'/output/result.pdf';
    if(job.input_path!==input||job.output_path!==null&&job.output_path!==output)throw new TransportError(502,'upstream_error','The saved file path is invalid.');return {input,output,request};
  }
  async function sign(path:string,direction:'upload'|'download',seconds=60):Promise<string>{
    const prefix=direction==='upload'?'/storage/v1/object/upload/sign/':'/storage/v1/object/sign/';
    const data=record(await service(prefix+bucket+'/'+path,'POST',direction==='upload'?{}:{expiresIn:seconds})),relative=data[direction==='upload'?'url':'signedURL'];
    try{if(typeof relative!=='string'||!relative.startsWith('/object/'))throw Error('Invalid signer response');return validateStorageUrl(project.origin+'/storage/v1'+relative,project.origin,bucket+'/'+path,direction);}catch{throw new TransportError(502,'upstream_error','The service returned an invalid file link.');}
  }
  async function purge(job:Job):Promise<boolean>{
    if(!terminal.has(job.state))return false;
    const root=job.owner_id+'/'+job.id+'/',input=job.input_path;
    if(typeof input!=='string'||!new RegExp('^'+root+'input/0\\.(pdf|docx|pptx|xlsx)$').test(input))throw new TransportError(502,'upstream_error','Invalid cleanup path.');
    try{await service('/storage/v1/object/'+bucket,'DELETE',{prefixes:job.state==='completed'?[input]:[input,root+'output/result.pdf']});return false;}catch{return true;}
  }
  async function dispatch(kind:'process'|'cancel',job:string,claim:string):Promise<void>{
    const response=await upstream(worker.origin+'/api/'+kind,{method:'POST',headers:{'content-type':'application/json','x-vercel-protection-bypass':config.workerBypass},body:JSON.stringify({job,...(kind==='process'?{claim}:{cancelClaim:claim})})});
    if(!response.ok)throw new TransportError(503,'dispatch_pending','The worker did not acknowledge this request. Check job status before retrying.');
  }
  async function body(request:Request){if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')??''))throw new TransportError(415,'invalid_request','Send JSON request data.');return record(await readJson(request));}
  function active(job:Job):void{if(job.state==='expired'||Date.parse(job.expires_at)<=now())throw new TransportError(410,'job_expired','This job has expired. Select the original file again.');}
  const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});

  async function handle(request:Request):Promise<Response>{
    const path=new URL(request.url).pathname.replace(/^\/(?:functions\/v1\/)?docflow-processing(?=\/|$)/,''),method=request.method;
    if(path==='/health'&&method==='GET')return json({service:'docflow-broker',acceptingDocuments:config.enabled&&config.cleanupReady});
    if(path==='/maintenance'){
      if(method!=='POST')throw new TransportError(405,'method_not_allowed','Use POST for this route.');
      const hash=await sha256(bearer(request));
      if(!/^[a-f\d]{64}$/.test(config.cleanupHash)||!equalSecret(hash,config.cleanupHash))throw new TransportError(401,'invalid_claim','A valid maintenance credential is required.');
      if(Object.keys(await body(request)).length)throw new TransportError(400,'invalid_request','This action does not accept additional fields.');
      if(await service('/rest/v1/rpc/docflow_cleanup_authorize','POST',{p_hash:hash})!==true)throw new TransportError(401,'invalid_claim','A valid maintenance credential is required.');
      let deleted=0,batches=0;
      for(let batch=0;batch<5;batch++){
        const claimed=record(await service('/rest/v1/rpc/docflow_cleanup_claim','POST',{p_limit:100}));
        if(claimed.busy===true)return json({deleted,batches,busy:true},202);
        if(!uuid(claimed.lease))throw new TransportError(503,'cleanup_unavailable','Temporary file cleanup is unavailable.');
        let ok=false,count=0;
        try{
          if(!Array.isArray(claimed.names)||claimed.names.length>100||new Set(claimed.names).size!==claimed.names.length||claimed.names.some(name=>{
            if(typeof name!=='string')return true;const parts=name.split('/');
            return parts.length!==4||!uuid(parts[0])||!uuid(parts[1])||!(/^(input\/0\.(pdf|docx|pptx|xlsx)|output\/result\.pdf)$/.test(parts.slice(2).join('/')));
          }))throw Error('Invalid cleanup scope');
          if(claimed.names.length)await service('/storage/v1/object/'+bucket,'DELETE',{prefixes:claimed.names});
          count=claimed.names.length;ok=true;
        }catch{/* Persist failure without exposing paths or credentials. */}
        const acknowledged=await service('/rest/v1/rpc/docflow_cleanup_ack','POST',{p_lease:claimed.lease,p_ok:ok,p_deleted:count});
        if(!ok||acknowledged!==true)throw new TransportError(503,'cleanup_unavailable','Temporary file cleanup is unavailable.');
        deleted+=count;batches++;if(count===0)break;
      }
      return json({deleted,batches,busy:false});
    }
    const callback=path.match(/^\/worker\/jobs\/([a-f\d-]+)\/(claim|attach|finish|cancel-claim|cancelled)$/i);
    if(callback){
      if(method!=='POST')throw new TransportError(405,'method_not_allowed','Use POST for this route.');
      const id=callback[1]!,kind=callback[2]!,data=await body(request);if(!uuid(id))throw new TransportError(404,'job_not_found','This job is unavailable.');
      const cancellation=kind==='cancel-claim'||kind==='cancelled',secret=data[cancellation?'cancelClaim':'claim'];
      if(typeof secret!=='string'||!/^[a-f\d]{64}$/.test(secret))throw new TransportError(401,'invalid_claim','A valid worker claim is required.');
      const allowed=kind==='finish'?['claim','attempt','outcome','output','details','errorCode']:kind==='attach'?['claim','attempt']:[cancellation?'cancelClaim':'claim'];
      if(Object.keys(data).some(key=>!allowed.includes(key)))throw new TransportError(400,'invalid_request','Unknown worker request field.');
      const hashed=await sha256(secret);
      if(kind==='claim'){
        const claimed=checkedJob(await action('claim',{job:id,claimHash:hashed}));active(claimed);const saved=paths(claimed);
        try{return json({id,ownerId:claimed.owner_id,attempt:claimed.attempt,expiresAt:claimed.expires_at,leaseUntil:(claimed as Job&{lease_until:string}).lease_until,request:saved.request,inputPath:saved.input,outputPath:saved.output,inputUrl:await sign(saved.input,'download'),outputUrl:await sign(saved.output,'upload'),vmName:'df-'+id+'-'+claimed.attempt});}
        catch(error){try{const failed=checkedJob(await action('finish',{job:id,claimHash:hashed,attempt:claimed.attempt,outcome:'failed',errorCode:'worker_error'}));await purge(failed);}catch{/* The lease/maintenance path recovers an uncertain upstream failure. */}throw error;}
      }
      if(cancellation){
        const value=await action(kind,{job:id,cancelHash:hashed});
        if(kind==='cancelled'){const cancelled=checkedJob(value);return json({job:publicJob(cancelled),cleanupPending:await purge(cancelled)});}
        const state=record(value);if(!Number.isSafeInteger(state.attempt)||Number(state.attempt)<1||state.vmName!==null&&state.vmName!=='df-'+id+'-'+state.attempt)throw new TransportError(502,'upstream_error','Invalid cancellation state.');return json({vmName:state.vmName,attempt:state.attempt});
      }
      if(!Number.isSafeInteger(data.attempt)||Number(data.attempt)<1)throw new TransportError(400,'invalid_request','A valid worker attempt is required.');
      const attempt=Number(data.attempt),attachment=record(await action('attach',{job:id,attempt,claimHash:hashed,vmName:'df-'+id+'-'+attempt}));
      if(kind==='attach')return json({cancel:attachment.cancel===true});
      if(data.outcome!=='completed'&&data.outcome!=='failed')throw new TransportError(400,'invalid_request','Invalid worker outcome.');
      let output:OutputFile|undefined;
      if(data.outcome==='completed'&&attachment.cancel!==true){
        try{output=validateOutput(data.output);}catch{throw new TransportError(400,'invalid_output','Invalid output metadata.');}
        // Authorization above precedes any privileged output read. The actual
        // object is measured independently before the SQL publication CAS.
      }
      // The worker cannot choose the owner/path. Resolve the service-owned row
      // after authorizing its attempt; PostgREST returns only this exact ID.
      const rows=await service('/rest/v1/docflow_jobs?id=eq.'+id+'&select=*','GET');
      if(!Array.isArray(rows)||rows.length!==1)throw new TransportError(404,'job_not_found','This job is unavailable.');
      const current=checkedJob(rows[0]);
      if(output){
        const response=await upstream(project.origin+'/storage/v1/object/'+bucket+'/'+paths(current).output,{method:'GET',headers:serviceHeaders});
        if(!response.ok)throw new TransportError(503,'output_unavailable','The worker output is not available yet.');
        const bytes=await readBytes(response,LIMITS.outputBytes);
        if(bytes.length!==output.size||new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-'||await sha256(bytes)!==output.sha256){
          try{await purge(checkedJob(await action('finish',{job:id,attempt,claimHash:hashed,outcome:'failed',errorCode:'worker_error'})));}catch{/* Scheduled maintenance remains responsible for uncertain publication. */}
          throw new TransportError(422,'invalid_output','The stored output failed verification.');
        }
      }
      const finished=checkedJob(await action('finish',{job:id,attempt,claimHash:hashed,outcome:attachment.cancel===true?'failed':data.outcome,...(output?{output}:{}),details:data.details??null,errorCode:['unsupported_input','engine_error','deadline','worker_error'].includes(String(data.errorCode))?data.errorCode:'worker_error'}));
      return json({job:publicJob(finished),cleanupPending:await purge(finished)});
    }
    const match=path.match(/^\/api\/v1\/jobs(?:\/([a-f\d-]+)(?:\/(start|cancel|downloads))?)?$/i);
    if(!match)throw new TransportError(404,'not_found','This processing route does not exist.');
    const id=match[1],route=match[2]??'';if(id&&!uuid(id))throw new TransportError(404,'not_found','This job is unavailable.');
    const user=await owner(request);
    if(!id){
      if(method!=='POST')throw new TransportError(405,'method_not_allowed','Use POST for this route.');
      if(!config.cleanupReady)throw new TransportError(503,'cleanup_unavailable','Temporary file cleanup is unavailable. Try again later.');
      if(!config.enabled&&!config.allowedOwners.includes(user))throw new TransportError(503,'processing_not_ready','Server document processing is not enabled yet.');
      let parsed:CreateJobRequest;try{parsed=parseCreateJobRequest(await body(request));}catch(error){if(error instanceof TransportError)throw error;throw new TransportError(400,'invalid_request',error instanceof Error?error.message:'Invalid processing request.');}
      const job=checkedJob(await action('create',{owner:user,idempotencyKey:parsed.idempotencyKey,requestHash:await sha256(JSON.stringify(parsed)),request:parsed}),user);active(job);
      if(job.state!=='queued'||job.phase!=='awaiting_upload')return json({job:publicJob(job)});
      return json({job:publicJob(job),upload:{url:await sign(paths(job).input,'upload'),method:'PUT',headers:{'content-type':parsed.files[0].type,'cache-control':'max-age=0'},credentialLifetimeSeconds:7200}},201);
    }
    const job=checkedJob(await action('read',{job:id,owner:user}),user);
    if(!route&&method==='GET')return json({job:publicJob(job)});
    if(route==='downloads'&&method==='GET'){
      active(job);if(job.state!=='completed')throw new TransportError(409,'output_not_ready','This job has no completed output.');
      const seconds=Math.min(60,Math.floor((Date.parse(job.expires_at)-now())/1000));if(seconds<1)throw new TransportError(410,'job_expired','This output has expired.');
      return json({output:validateOutput(job.output),url:await sign(paths(job).output,'download',seconds),expiresAt:new Date(now()+seconds*1000).toISOString()});
    }
    if((route==='start'||route==='cancel')&&method==='POST'){
      const data=await body(request);if(Object.keys(data).length)throw new TransportError(400,'invalid_request','This action does not accept additional fields.');
      if(route==='cancel'){
        const claim=token(),result=record(await action('cancel',{owner:user,job:id,cancelHash:await sha256(claim)})),cancelled=checkedJob(result.job,user);
        if(result.dispatch===true)await dispatch('cancel',id,claim);
        return json({job:publicJob(cancelled),cleanupPending:await purge(cancelled)},cancelled.state==='cancelling'?202:200);
      }
      active(job);if(!config.cleanupReady)throw new TransportError(503,'cleanup_unavailable','Temporary file cleanup is unavailable. Try again later.');if(!config.enabled&&!config.allowedOwners.includes(user))throw new TransportError(503,'processing_not_ready','Server document processing is not enabled yet.');
      if(job.state!=='queued')return json({job:publicJob(job)},202);
      const saved=paths(job),head=await upstream(project.origin+'/storage/v1/object/'+bucket+'/'+saved.input,{method:'HEAD',headers:serviceHeaders});
      if(head.status===404)throw new TransportError(409,'upload_required','Finish uploading the input before starting.');
      if(!head.ok)throw new TransportError(503,'storage_unavailable','The uploaded file could not be checked.');
      if(Number(head.headers.get('content-length'))!==saved.request.files[0].size||head.headers.get('content-type')?.split(';')[0]!==saved.request.files[0].type){
        const cancelled=record(await action('cancel',{owner:user,job:id,cancelHash:await sha256(token())}));await purge(checkedJob(cancelled.job,user));throw new TransportError(400,'input_mismatch','The uploaded file does not match its declaration. Select the original file again.');
      }
      const claim=token(),result=record(await action('start',{owner:user,job:id,claimHash:await sha256(claim)})),started=checkedJob(result.job,user);
      if(result.dispatch===true)await dispatch('process',id,claim);
      return json({job:publicJob(started)},202);
    }
    throw new TransportError(405,'method_not_allowed','This method is not supported.');
  }
  return async(request:Request):Promise<Response>=>{
    const requestOrigin=request.headers.get('origin'),allowed=!requestOrigin||config.allowedOrigins.includes(requestOrigin);let response:Response;
    try{
      if(!allowed)throw new TransportError(403,'origin_not_allowed','This browser origin is not allowed.');
      if(request.method==='OPTIONS')response=new Response(null,{status:204,headers:{'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'authorization, apikey, content-type','access-control-max-age':'600'}});
      else response=await handle(request);
    }catch(error){response=error instanceof TransportError?json({error:{code:error.code,message:error.message}},error.status):json({error:{code:'service_unavailable',message:'The processing service is temporarily unavailable.'}},503);}
    if(requestOrigin&&allowed)response.headers.set('access-control-allow-origin',requestOrigin);
    response.headers.set('vary','Origin');response.headers.set('cache-control','no-store');response.headers.set('x-content-type-options','nosniff');return response;
  };
}
