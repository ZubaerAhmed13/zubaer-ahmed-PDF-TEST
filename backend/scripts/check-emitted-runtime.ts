/** Match the TypeScript-to-JavaScript boundary used by the hosted Functions. */
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const directory=await mkdtemp(join(root,'.runtime-check-'));
try{
  execFileSync(join(root,'node_modules','.bin','tsc'),['-p',join(root,'tsconfig.json'),'--noEmit','false','--outDir',directory],{stdio:'pipe'});
  for(const handler of ['process','cancel','health']){
    const entry=await import(pathToFileURL(join(directory,'api',handler+'.js')).href);
    if(typeof entry[handler==='health'?'GET':'POST']!=='function')throw Error('Missing emitted processing handler');
    if(handler==='cancel'){
      const response=await entry.POST(new Request('https://worker.example/api/cancel',{method:'POST'}));
      if(response.status!==415)throw Error('Cancellation must validate the request even without a prepared image');
    }
  }
  console.log('Emitted processing and health handlers load successfully');
}finally{await rm(directory,{recursive:true,force:true});}
