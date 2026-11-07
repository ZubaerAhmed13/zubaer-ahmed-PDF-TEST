/** Shared bounded transport. No provider credentials or document bytes are logged. */
export class TransportError extends Error {
  readonly status:number;
  readonly code:string;
  constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code;}
}
export async function readBytes(source:{body:ReadableStream<Uint8Array>|null;headers:Headers},maximum:number):Promise<Uint8Array>{
  const length=source.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maximum))throw new TransportError(413,'resource_limit','The response exceeds the file limit.');
  if(!source.body)return new Uint8Array();
  const reader=source.body.getReader(),parts:Uint8Array[]=[];let total=0;
  try{for(;;){const chunk=await reader.read();if(chunk.done)break;total+=chunk.value.byteLength;if(total>maximum)throw new TransportError(413,'resource_limit','The response exceeds the file limit.');parts.push(chunk.value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
}
export async function readJson(source:{body:ReadableStream<Uint8Array>|null;headers:Headers},maximum=16384):Promise<unknown>{
  const bytes=await readBytes(source,maximum);
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new TransportError(400,'invalid_request','Send a valid JSON object.');}
}
export function record(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TransportError(400,'invalid_request','Send a JSON object.');return value as Record<string,unknown>;
}
export async function sha256(value:Uint8Array|string):Promise<string>{
  const bytes=typeof value==='string'?new TextEncoder().encode(value):value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export const opaqueToken=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
export const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value);
export function bearer(request:Request):string{
  const value=request.headers.get('authorization')??'';if(value.length>8192||!/^Bearer [A-Za-z\d._-]+$/.test(value))throw new TransportError(401,'authentication_required','Sign in to continue.');return value.slice(7);
}
export function equalSecret(left:string,right:string):boolean{let difference=left.length^right.length;for(let index=0;index<right.length;index++)difference|=(left.charCodeAt(index)||0)^right.charCodeAt(index);return difference===0;}
