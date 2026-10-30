import {runtimeWorker} from '../runtime.ts';
export async function POST(request:Request){
  try{return await runtimeWorker().process(request);}catch{return Response.json({error:{code:'worker_not_ready',message:'The verified processing image is unavailable.'}},{status:503,headers:{'cache-control':'no-store'}});}
}
