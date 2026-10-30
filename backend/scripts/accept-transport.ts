/** Explicit build-time staging probe. Never exposed as an HTTP handler. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {Sandbox,APIError} from '@vercel/sandbox';
import {NOTICE_VERSION,parseCreateJobRequest,validateOutput,type CreateJobRequest} from '../contracts.ts';
import {readBytes,readJson,record,uuid} from '../http.ts';

if(process.env.DOCFLOW_ACCEPT_TRANSPORT!=='1'||process.env.VERCEL_ENV!=='preview')throw Error('Hosted acceptance requires an explicitly enabled preview build');
const base=new URL('../',import.meta.url),project='https://ruefkvkavvycposzahit.supabase.co',broker=project+'/functions/v1/docflow-processing';
const users=JSON.parse(process.env.DOCFLOW_ACCEPTANCE_USERS??'[]') as {id:string;email:string;password:string}[];
const publicKey=process.env.DOCFLOW_ACCEPTANCE_PUBLIC_KEY,runId=process.env.DOCFLOW_ACCEPTANCE_RUN;
if(users.length!==2||!users.every(user=>uuid(user.id)&&/^docflow-transport-[ab]-[a-f\d-]+@example\.invalid$/.test(user.email)&&/^[a-f\d]{64}$/.test(user.password))||!publicKey||!uuid(runId))throw Error('Synthetic acceptance accounts are not configured');
interface Fixture{name:string;base64:string;operation:string;options:Record<string,unknown>;expectedPhrases:string[];expectedPages:number;cancellationOnly?:boolean}
const fixtures=JSON.parse(await readFile(new URL('fixtures/transport.json',base),'utf8')) as Fixture[];
const digest=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
function key(label:string){const bytes=Buffer.from(digest(runId!+label).slice(0,32),'hex');bytes[6]=(bytes[6]!&15)|64;bytes[8]=(bytes[8]!&63)|128;const hex=bytes.toString('hex');return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');}
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function http(url:string,init:RequestInit={}){return fetch(url,{...init,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(25000)});}
async function json(response:Response,label:string){const value=record(await readJson(response,65536));if(!response.ok)throw Error(label+': HTTP '+response.status+' '+String((value.error as Record<string,unknown>|undefined)?.code??'request_failed'));return value;}
const tokens:string[]=[];
for(const user of users){
  const session=await json(await http(project+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:publicKey,'content-type':'application/json'},body:JSON.stringify({email:user.email,password:user.password})}),'synthetic_login');
  if(record(session.user).id!==user.id||typeof session.access_token!=='string')throw Error('Unexpected synthetic identity');tokens.push(session.access_token);
}
async function api(suffix:string,method='GET',body?:unknown,who=0){return http(broker+'/api/v1'+suffix,{method,headers:{authorization:'Bearer '+tokens[who],apikey:publicKey!,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});}
const evidence:{name:string;[key:string]:unknown}[]=[],outputs:{name:string;base64:string}[]=[];
const destination=new URL('public/acceptance/',base);await mkdir(destination,{recursive:true});
async function checkpoint(){await writeFile(new URL('results.json',destination),JSON.stringify({runId,source:process.env.VERCEL_GIT_COMMIT_SHA,evidence,outputs},null,2));}
function request(fixture:Fixture,label:string,bytes=Buffer.from(fixture.base64,'base64')):CreateJobRequest{
  const types:Record<string,string>={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
  return parseCreateJobRequest({operation:fixture.operation,idempotencyKey:key(label),consent:{accepted:true,noticeVersion:NOTICE_VERSION},files:[{name:fixture.name,type:types[fixture.name.split('.').pop()!],size:bytes.length,sha256:digest(bytes)}],options:fixture.options});
}
async function create(fixture:Fixture,label:string,bytes=Buffer.from(fixture.base64,'base64')){
  const value=await json(await api('/jobs','POST',request(fixture,label,bytes)),'create_'+label),job=record(value.job);
  if(!uuid(job.id))throw Error('Invalid created job');
  if(value.upload){const upload=record(value.upload);if(typeof upload.url!=='string')throw Error('Missing upload URL');const response=await http(upload.url,{method:'PUT',headers:upload.headers as Record<string,string>,body:bytes});if(!response.ok)throw Error('Synthetic upload failed: '+response.status);}
  return {id:job.id,job,upload:value.upload?record(value.upload):undefined};
}
async function poll(id:string,wanted:string){
  const deadline=Date.now()+195000;
  while(Date.now()<deadline){const job=record((await json(await api('/jobs/'+id),'poll')).job);if(job.state===wanted)return job;if(['failed','expired','cancelled','completed'].includes(String(job.state))&&!(wanted==='expired'&&job.state==='completed'))throw Error('Unexpected job state: '+job.state+' '+String(job.errorCode??''));await pause(1000);}
  throw Error('Hosted job exceeded its acceptance deadline');
}
async function download(id:string,label:string){const value=await json(await api('/jobs/'+id+'/downloads'),'download_link'),metadata=validateOutput(value.output);if(typeof value.url!=='string')throw Error('Missing download');const response=await http(value.url);if(!response.ok)throw Error('Output download failed');const bytes=await readBytes(response,50*1024*1024);if(bytes.length!==metadata.size||digest(bytes)!==metadata.sha256||new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')throw Error('Downloaded bytes failed verification');
  outputs.push({name:label+'.pdf',base64:Buffer.from(bytes).toString('base64')});return {metadata,url:value.url};
}

const first=fixtures.find(fixture=>fixture.name==='office.docx')!;
if((await http(broker+'/api/v1/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request(first,'anonymous'))})).status!==401)throw Error('Anonymous create was accepted');
if((await api('/jobs','POST',{...request(first,'wrong-owner'),owner:users[1]!.id})).status!==400)throw Error('Client-selected owner was accepted');
const completed:string[]=[];
for(const fixture of fixtures.filter(fixture=>!fixture.cancellationOnly)){
  const startedAt=Date.now(),created=await create(fixture,fixture.name);
  for(const [suffix,method] of [['','GET'],['/start','POST'],['/cancel','POST'],['/downloads','GET']])if((await api('/jobs/'+created.id+suffix,method,method==='POST'?{}:undefined,1)).status!==404)throw Error('Cross-owner access was accepted');
  const starts=await Promise.all(Array.from({length:fixture.operation==='compress'?2:1},()=>api('/jobs/'+created.id+'/start','POST',{})));
  if(starts.some(response=>response.status!==202&&response.status!==503))throw Error('Unexpected start response');
  const job=await poll(created.id,'completed');if(job.attempt!==1)throw Error('Duplicate start consumed another attempt');
  const result=await download(created.id,fixture.name);if(result.metadata.pages!==fixture.expectedPages)throw Error('Unexpected output page count');
  if(fixture.operation==='compress'&&result.metadata.size>=Buffer.from(fixture.base64,'base64').length)throw Error('Compression did not reduce this synthetic raster');
  completed.push(created.id);evidence.push({name:fixture.name,job:created.id,state:'completed',attempt:job.attempt,inputBytes:Buffer.from(fixture.base64,'base64').length,output:result.metadata,elapsedMs:Date.now()-startedAt,ownerIsolation:true,concurrentStarts:starts.length});await checkpoint();console.log('DOCFLOW_ACCEPTED',fixture.name,created.id);
}

const cancellation=fixtures.find(fixture=>fixture.cancellationOnly)!;
const live=await create(cancellation,'live-cancel');await json(await api('/jobs/'+live.id+'/start','POST',{}),'cancel_start');
const vmName='df-'+live.id+'-1';let observed=false;
for(let retry=0;retry<60;retry++){
  try{const vm=await Sandbox.get({name:vmName,resume:false,signal:AbortSignal.timeout(5000)});const log=await vm.readFile({path:'/vercel/sandbox/job/engine.log'},{signal:AbortSignal.timeout(5000)});if(log){(log as Readable).destroy();observed=true;break;}}
  catch(error){if(!(error instanceof APIError&&error.response.status===404))throw Error('Could not observe the synthetic cancellation VM');}
  await pause(500);
}
if(!observed)throw Error('Cancellation did not observe an executing VM');
const cancelled=await api('/jobs/'+live.id+'/cancel','POST',{});if(!cancelled.ok)throw Error('Live cancellation was not acknowledged');await poll(live.id,'cancelled');
let stopped=false;try{const vm=await Sandbox.get({name:vmName,resume:false,signal:AbortSignal.timeout(5000)});stopped=vm.status!=='running';}catch(error){if(error instanceof APIError&&error.response.status===404)stopped=true;else throw Error('Could not verify the stopped cancellation VM');}
if(!stopped)throw Error('Cancelled VM is still running');
evidence.push({name:'live-cancel',job:live.id,observedExecuting:true,vmStopped:true,state:'cancelled'});await checkpoint();

const malformed=Buffer.from('%PDF-1.7\nThis is a synthetic malformed PDF.\n');
const invalid=await create(fixtures.find(fixture=>fixture.operation==='compress')!,'malformed',malformed);await json(await api('/jobs/'+invalid.id+'/start','POST',{}),'malformed_start');await poll(invalid.id,'failed');
if((await api('/jobs/'+invalid.id+'/downloads')).status!==409)throw Error('A failed engine exposed output');
evidence.push({name:'malformed',job:invalid.id,state:'failed',outputUnavailable:true});

const replay=await create(first,'replayed-upload');await json(await api('/jobs/'+replay.id+'/cancel','POST',{}),'queued_cancel');
if(!replay.upload)throw Error('Missing replay fixture credential');
const recreated=await http(String(replay.upload.url),{method:'PUT',headers:replay.upload.headers as Record<string,string>,body:Buffer.from(first.base64,'base64')});if(!recreated.ok)throw Error('Could not recreate the replay fixture');
evidence.push({name:'upload-replay',job:replay.id,recreatedAfterCancel:true,purgeVerification:'external-control-plane-required'});
await checkpoint();

// The coordinator expires this synthetic job and dispatches the actual cleanup.
// No database/service credential is supplied to this build-time probe.
const expiring=completed[0]!,link=await json(await api('/jobs/'+expiring+'/downloads'),'expiry_link');
console.log('DOCFLOW_AWAIT_EXPIRY',JSON.stringify({job:expiring,replay:replay.id}));
await poll(expiring,'expired');
if((await api('/jobs/'+expiring+'/downloads')).status!==410)throw Error('Expired output was signed');
let removed=false;
for(let retry=0;retry<30;retry++){const response=await http(String(link.url));if(!response.ok){removed=true;break;}await pause(1000);}
if(!removed)throw Error('Expired signed output remained downloadable');
if(Date.parse(String(link.expiresAt))<=Date.now())throw Error('Physical deletion was not observed before the signed link expired');
evidence.push({name:'expiry',job:expiring,state:'expired',newLinkRejected:true,previousLinkUnavailable:true,linkStillValidAtCheck:true});
await checkpoint();console.log('DOCFLOW_TRANSPORT_ACCEPTANCE_PASSED',evidence.length);
