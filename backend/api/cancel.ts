import {runtimeWorker} from '../runtime.ts';
export async function POST(request:Request){
  try{return await runtimeWorker().cancel(request);}catch{return Response.json({error:{code:'worker_not_ready',message:'The cancellation service is temporarily unavailable.'}},{status:503,headers:{'cache-control':'no-store'}});}
}
