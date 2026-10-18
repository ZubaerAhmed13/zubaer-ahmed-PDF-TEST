import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
const pkg=JSON.parse(await readFile('package.json','utf8'));
const commit=process.env.GITHUB_SHA||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function walk(root,prefix='') {
  const entries=(await readdir(root,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
  const paths=[];
  for(const entry of entries) {
    if(entry.isSymbolicLink())throw Error('Release artifacts cannot contain symlinks.');
    const path=prefix+entry.name;
    if(entry.isDirectory())paths.push(...await walk(join(root,entry.name),path+'/'));else if(entry.isFile())paths.push(path);
  }
  return paths;
}
const files=[],zip=new JSZip(),prefix=`docflow-${pkg.version}/`;
const options={date:new Date('1980-01-01T00:00:00Z'),unixPermissions:0o100644,createFolders:false};
for(const path of await walk('dist')) {
  const bytes=await readFile(join('dist',path));files.push({path,bytes:bytes.length,sha256:hash(bytes)});zip.file(prefix+path,bytes,options);
}
const manifest=JSON.stringify({version:pkg.version,commit,files},null,2)+'\n';
zip.file(prefix+'release-manifest.json',manifest,options);
const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6},platform:'UNIX'});
const name=`docflow-${pkg.version}.zip`;
await mkdir('artifacts/release',{recursive:true});
await writeFile('artifacts/release/'+name,bytes);
await writeFile('artifacts/release/release-manifest.json',manifest);
await writeFile('artifacts/release/SHA256SUMS',hash(bytes)+'  '+name+'\n');
console.log(`${name}: ${bytes.length} bytes, SHA-256 ${hash(bytes)}`);
