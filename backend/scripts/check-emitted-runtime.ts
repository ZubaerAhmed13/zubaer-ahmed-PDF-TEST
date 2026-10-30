/** Match the TypeScript-to-JavaScript boundary used by the hosted Functions. */
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const directory=await mkdtemp(join(root,'.runtime-check-'));
try{
  execFileSync(join(root,'node_modules','.bin','tsc'),['-p',join(root,'tsconfig.json'),'--noEmit','false','--outDir',directory],{stdio:'pipe'});
  for(const handler of ['process','cancel']){
    const entry=await import(pathToFileURL(join(directory,'api',handler+'.js')).href);
    if(typeof entry.POST!=='function')throw Error('Missing emitted processing handler');
  }
  console.log('Emitted processing handlers load successfully');
}finally{await rm(directory,{recursive:true,force:true});}
