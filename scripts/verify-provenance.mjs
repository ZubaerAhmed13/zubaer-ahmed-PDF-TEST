import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const expected=await json('scripts/vendor-integrity.json');
for(const [path,hash] of Object.entries(expected)) {
  const actual=createHash('sha256').update(await readFile(path)).digest('hex');
  if(actual!==hash)throw Error('Vendor integrity mismatch: '+path);
}
if((await readFile('public/licenses/qpdf-Apache-2.0.txt','utf8'))!==(await readFile('src/vendor/qpdf/LICENSE.txt','utf8')))throw Error('Packaged qpdf license mismatch');
const pkg=await json('package.json'),lock=await json('package-lock.json');
const packages=[];
for(const [path,entry] of Object.entries(lock.packages)) {
  if(!path)continue;
  if(!entry.integrity?.startsWith('sha512-')||!entry.resolved?.startsWith('https://registry.npmjs.org/'))throw Error('Missing immutable npm provenance: '+path);
  packages.push({path,version:entry.version,license:entry.license??'not declared in lockfile',integrity:entry.integrity,resolved:entry.resolved});
}
for(const [name,version] of Object.entries({...pkg.dependencies,...pkg.devDependencies})) {
  if(!/^\d+\.\d+\.\d+$/.test(version)||lock.packages['node_modules/'+name]?.version!==version)throw Error('Unpinned or inconsistent dependency: '+name);
  const installed=await json('node_modules/'+name+'/package.json');
  if(installed.version!==version)throw Error('Installed version mismatch: '+name);
}
await mkdir('artifacts/r5',{recursive:true});
await writeFile('artifacts/r5/provenance.json',JSON.stringify({applicationLicense:pkg.license,vendor:expected,packages},null,2)+'\n');
console.log(`Verified ${Object.keys(expected).length} vendor/font files and ${packages.length} locked npm package records.`);
