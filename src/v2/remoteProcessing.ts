import {LIMITS,NOTICE_VERSION,parseCreateJobRequest,validateOutput,validateStorageUrl,type CompressOptions,type OcrOptions} from '../../backend/contracts';
import {readBytes,readJson,record,sha256,uuid} from '../../backend/http';
import type {OperationResult} from '../pdf/types';

export type RemoteSettings={operation:'ocr';options:OcrOptions}|{operation:'compress';options:CompressOptions}|{operation:'office-to-pdf';options:Record<string,never>};
export interface ProcessingIdentity{id:string;accessToken:string}
export interface RemoteConfig{projectUrl:string;publishableKey:string}
interface Dependencies{fetch:typeof fetch;identity:()=>Promise<ProcessingIdentity>;sleep?:(milliseconds:number)=>Promise<void>;progress?:(message:string)=>void}
interface RemoteJob{id:string;state:'queued'|'running'|'cancelling'|'cancelled'|'completed'|'failed'|'expired';phase:string;errorCode?:string}
export interface Cancellation{state:RemoteJob['state'];cleanupPending:boolean}
export interface RemoteOperation{result:Promise<OperationResult>;cancel:()=>Promise<Cancellation>;jobId:()=>string|null;requestKey:string}
export class RemoteProcessingError extends Error{
  readonly code:string;
  constructor(code:string,message:string){super(message);this.code=code;}
}
const terminal=new Set(['cancelled','completed','failed','expired']);
function job(value:unknown,id?:string):RemoteJob{
  const data=record(value);
  if(!uuid(data.id)||id!==undefined&&data.id!==id||!['queued','running','cancelling',...terminal].includes(String(data.state)))throw new Error('The server returned an invalid job status.');
  return data as unknown as RemoteJob;
}

/** No upload begins until consent, identity, file limits and scoped links pass. */
export function startRemoteProcessing(file:File,settings:RemoteSettings,consent:boolean,config:RemoteConfig,deps:Dependencies):RemoteOperation{
  const requestKey=crypto.randomUUID(),sleep=deps.sleep??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  let origin:string;try{const url=new URL(config.projectUrl);if(url.protocol!=='https:'||url.pathname!=='/'||url.username||url.password||url.search||url.hash||!config.publishableKey.startsWith('sb_publishable_'))throw Error();origin=url.origin;}catch{throw new Error('Server processing is not configured in this build.');}
  let current:RemoteJob|null=null,identity:ProcessingIdentity|null=null,cancelRequested=false,creationSent=false,knownSettled=false;
  let resolveKnown:(id:string|null)=>void=()=>{};const known=new Promise<string|null>(resolve=>{resolveKnown=resolve;});
  const settleKnown=(id:string|null)=>{if(!knownSettled){knownSettled=true;resolveKnown(id);}};
  let transfer:AbortController|null=null,cancellation:Promise<Cancellation>|null=null;
  const note=(message:string)=>{if(!cancelRequested)deps.progress?.(message);};
  async function api(path:string,method='GET',body?:unknown):Promise<Record<string,unknown>>{
    const active=await deps.identity();
    if(!uuid(active.id)||!active.accessToken||identity&&active.id!==identity.id)throw new RemoteProcessingError('authentication_changed','Sign in with the account that started this job.');identity=active;
    let response:Response;try{response=await deps.fetch(origin+'/functions/v1/docflow-processing/api/v1'+path,{method,credentials:'omit',redirect:'error',cache:'no-store',headers:{authorization:'Bearer '+active.accessToken,apikey:config.publishableKey,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});}catch{throw new RemoteProcessingError('network_error','The server could not be reached. Check the job before retrying.');}
    let value:Record<string,unknown>;
    try{value=record(await readJson(response,65536));}catch{throw new RemoteProcessingError('network_error','The server response was incomplete. Check the job before retrying.');}
    if(!response.ok){const error=value.error&&typeof value.error==='object'?value.error as Record<string,unknown>:{};throw new RemoteProcessingError(typeof error.code==='string'?error.code:'server_error',typeof error.message==='string'?error.message:'Server processing is temporarily unavailable.');}
    return value;
  }
  function cancel():Promise<Cancellation>{
    if(cancellation)return cancellation;
    if(current?.state==='completed')return Promise.resolve({state:'completed',cleanupPending:false});
    cancelRequested=true;transfer?.abort();deps.progress?.('Requesting server cancellation…');
    cancellation=(async()=>{
      const id=await known;
      if(!id){if(creationSent)throw Error('Server cancellation is not confirmed. Check the job before retrying.');deps.progress?.('Cancelled before upload.');return {state:'cancelled',cleanupPending:false} as Cancellation;}
      try{
        const value=await api('/jobs/'+id+'/cancel','POST',{});current=job(value.job,id);let cleanupPending=value.cleanupPending===true;
        const deadline=Date.now()+45000;
        while(!terminal.has(current.state)&&Date.now()<deadline){await sleep(750);const status=await api('/jobs/'+id);current=job(status.job,id);cleanupPending=cleanupPending||status.cleanupPending===true;}
        if(!terminal.has(current.state))throw Error('Cancellation pending');
        deps.progress?.(current.state==='cancelled'?'Server processing cancelled.':current.state==='completed'?'The server finished before cancellation. Its output remains available until expiry.':'Server job stopped.');
        return {state:current.state,cleanupPending};
      }catch{throw new RemoteProcessingError('cancellation_pending','Server cancellation is not confirmed. Check the job before retrying.');}
    })();return cancellation;
  }
  async function checkCancellation(){if(cancelRequested){await cancel();throw new DOMException('Processing cancelled','AbortError');}}
  const result=(async():Promise<OperationResult>=>{
    try{
      if(!consent)throw new Error('Explicit upload consent is required for server processing.');
      if(!Number.isSafeInteger(file.size)||file.size<1||file.size>LIMITS.inputBytes)throw new Error('Server processing supports files up to 25 MB.');
      note('Checking document and sign-in…');
      const buffer=await file.arrayBuffer();if(cancelRequested){settleKnown(null);await checkCancellation();}
      if(buffer.byteLength!==file.size)throw new Error('The selected file could not be read completely.');
      const request=parseCreateJobRequest({...settings,idempotencyKey:requestKey,consent:{accepted:true,noticeVersion:NOTICE_VERSION},files:[{name:file.name,type:file.type,size:buffer.byteLength,sha256:await sha256(new Uint8Array(buffer))}]});
      if(cancelRequested){settleKnown(null);await checkCancellation();}
      creationSent=true;
      let created:Record<string,unknown>;
      try{created=await api('/jobs','POST',request);}catch(error){if(!(error instanceof RemoteProcessingError&&error.code==='network_error'))throw error;created=await api('/jobs','POST',request);}
      current=job(created.job);settleKnown(current.id);await checkCancellation();
      const extension=file.name.split('.').pop()!.toLowerCase(),root=identity!.id+'/'+current.id+'/';
      if(created.upload){
        const upload=record(created.upload);let url:string;try{url=validateStorageUrl(upload.url,origin,'docflow-processing/'+root+'input/0.'+extension,'upload');}catch{throw new Error('The server returned a file link outside this job scope.');}
        transfer=new AbortController();note('Uploading to private temporary storage…');
        const response=await deps.fetch(url,{method:'PUT',credentials:'omit',redirect:'error',cache:'no-store',headers:{'content-type':request.files[0].type,'cache-control':'max-age=0'},body:buffer,signal:AbortSignal.any([transfer.signal,AbortSignal.timeout(60000)])});
        transfer=null;if(!response.ok)throw new Error('The document upload did not finish. Retry from your original file.');
      }
      await checkCancellation();note('Starting isolated processing…');
      try{current=job((await api('/jobs/'+current.id+'/start','POST',{})).job,current.id);}catch(error){if(!(error instanceof RemoteProcessingError&&error.code==='dispatch_pending'))throw error;}
      const deadline=Date.now()+LIMITS.processingMs+45000;
      while(!terminal.has(current.state)){
        await checkCancellation();if(Date.now()>deadline){await cancel();throw new Error('Processing exceeded its time limit. Your original file is unchanged.');}
        note(current.state==='queued'?'Waiting for the processing worker…':'Processing in an isolated worker…');await sleep(1000);current=job((await api('/jobs/'+current.id)).job,current.id);
      }
      await checkCancellation();
      if(current.state!=='completed')throw new Error(current.state==='expired'?'This server job expired. Select the original file again.':current.state==='cancelled'?'This server job was cancelled.':'The server could not process this document ('+(current.errorCode??'worker_error')+'). Your original file is unchanged.');
      const value=await api('/jobs/'+current.id+'/downloads'),metadata=validateOutput(value.output);
      let url:string;try{url=validateStorageUrl(value.url,origin,'docflow-processing/'+root+'output/result.pdf','download');}catch{throw new Error('The server returned a file link outside this job scope.');}
      note('Downloading verified PDF…');transfer=new AbortController();const response=await deps.fetch(url,{credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.any([transfer.signal,AbortSignal.timeout(60000)])});if(!response.ok)throw new Error('The completed PDF could not be downloaded. Check the job before retrying.');
      const bytes=await readBytes(response,LIMITS.outputBytes);transfer=null;
      if(bytes.length!==metadata.size||new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-'||await sha256(bytes)!==metadata.sha256)throw new Error('The downloaded PDF failed verification; its bytes do not match the verified output.');
      await checkCancellation();
      return {outputs:[{name:settings.operation==='ocr'?'searchable-ocr.pdf':'processed.pdf',type:'application/pdf',buffer:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer}],info:{provider:'DocFlow · Supabase temporary storage + isolated Vercel processing',job:current.id,operation:settings.operation,pages:metadata.pages,sha256:metadata.sha256,warning:settings.operation==='ocr'?'OCR can make mistakes. Review names, numbers and page appearance before sharing.':''}};
    }catch(error){
      settleKnown(current?.id??null);
      if(cancelRequested){await cancel();throw new DOMException('Processing cancelled','AbortError');}
      if(current&&!terminal.has(current.state)){
        try{await cancel();}catch{throw new RemoteProcessingError('cleanup_pending',(error instanceof Error?error.message:'Processing failed.')+' Server cancellation is not confirmed. Check this job before retrying.');}
      }
      throw error;
    }
    finally{settleKnown(current?.id??null);transfer=null;}
  })();
  return {result,cancel,jobId:()=>current?.id??null,requestKey};
}
