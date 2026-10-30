import {createBroker,type BrokerConfig} from '../../../backend/broker.ts';
import {readJson,record,uuid} from '../../../backend/http.ts';

// Auth.getUser verifies end-user bearers inside the broker. Worker callbacks
// and maintenance use separate opaque, hashed credentials, so the platform
// JWT gate is disabled for this function only.
const projectUrl='https://ruefkvkavvycposzahit.supabase.co';
Deno.serve(async(request:Request)=>{
  try{
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if(!serviceKey||Deno.env.get('SUPABASE_URL')!==projectUrl)throw Error('Missing server configuration');
    const response=await fetch(projectUrl+'/rest/v1/rpc/docflow_processing_configuration',{method:'POST',redirect:'error',cache:'no-store',headers:{apikey:serviceKey,authorization:'Bearer '+serviceKey,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('Configuration unavailable');
    const config=record(await readJson(response,16384));
    if(typeof config.enabled!=='boolean'||typeof config.cleanupReady!=='boolean'||typeof config.workerUrl!=='string'||!/^https:\/\/docflow-processing-staging(?:-[a-z0-9-]+)?\.vercel\.app$/.test(config.workerUrl)||typeof config.workerBypass!=='string'||typeof config.cleanupHash!=='string'||!Array.isArray(config.allowedOwners)||config.allowedOwners.length>2||!config.allowedOwners.every(uuid)||!Array.isArray(config.allowedOrigins)||!config.allowedOrigins.every(origin=>typeof origin==='string'&&new URL(origin).origin===origin&&new URL(origin).protocol==='https:'))throw Error('Invalid server configuration');
    return await createBroker({...config,projectUrl,serviceKey} as BrokerConfig,{fetch})(request);
  }catch{
    return Response.json({error:{code:'service_unavailable',message:'The processing service is temporarily unavailable.'}},{status:503,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
  }
});
