import {Sandbox} from '@vercel/sandbox';
import {waitUntil} from '@vercel/functions';
import {Readable} from 'node:stream';
import {createWorker,type WorkerVM} from './worker.ts';
import engine from './engine-lock.json' with {type:'json'};
import snapshot from './engine-snapshot.json' with {type:'json'};

const projectUrl='https://ruefkvkavvycposzahit.supabase.co';
function adapt(vm:Sandbox):WorkerVM{return {
  mkdir:async path=>{await vm.mkDir(path);},
  writeFiles:async files=>{await vm.writeFiles(files.map(file=>({...file,content:Buffer.from(file.content)})));},
  readFile:async path=>{const stream=await vm.readFile({path},{signal:AbortSignal.timeout(15000)});return stream?Readable.toWeb(stream as Readable) as ReadableStream<Uint8Array>:null;},
  run:timeout=>vm.runCommand({cmd:'/vercel/sandbox/venv/bin/python',args:['/vercel/sandbox/engines.py','/vercel/sandbox/job'],cwd:'/vercel/sandbox',timeoutMs:timeout}),
  stop:async()=>{await vm.stop();},
};}
export function runtimeWorker(){
  if(!snapshot.verified||snapshot.snapshotId!==engine.snapshotId)throw Error('No matching verified processing image configured');
  return createWorker({projectUrl,brokerUrl:projectUrl+'/functions/v1/docflow-processing',...engine},{fetch,waitUntil,
    createVM:async options=>adapt(await Sandbox.create({name:options.name,source:{type:'snapshot',snapshotId:options.snapshotId},persistent:false,region:'fra1',resources:{vcpus:options.vcpus},timeout:options.timeout,networkPolicy:'deny-all',signal:options.signal})),
    openVM:async name=>{const vm=await Sandbox.get({name,resume:false,signal:AbortSignal.timeout(15000)});return {stop:async()=>{await vm.stop();}};},
  });
}
