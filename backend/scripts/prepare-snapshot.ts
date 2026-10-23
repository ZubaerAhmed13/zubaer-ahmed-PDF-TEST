/** Controlled deployment build only. Never exposed as a request handler. */
import {Sandbox} from '@vercel/sandbox';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const base = new URL('../', import.meta.url);
const existing = process.env.DOCFLOW_ENGINE_SNAPSHOT;
if (existing) {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(existing)) throw new Error('Invalid configured snapshot ID');
  await writeFile(new URL('engine-snapshot.json', base),JSON.stringify({snapshotId:existing,verified:true}));
} else {
  if (process.env.DOCFLOW_PREPARE_ENGINES !== '1') throw new Error('Engine preparation requires an explicit deployment build');
  const files = await Promise.all(['engines.py','test_engines.py','requirements-test.lock','test_acceptance.py'].map(async name=>({path:`/vercel/sandbox/${name}`,content:await readFile(new URL(name,base))})));
  let vm: Sandbox | undefined;
  let snapshotted = false;
  try {
    vm = await Sandbox.create({name:`df-engine-build-${Date.now()}`,persistent:false,region:'fra1',resources:{vcpus:2},timeout:300_000,networkPolicy:'allow-all',signal:AbortSignal.timeout(30_000)});
    await vm.writeFiles(files);
    async function checked(cmd: string,args: string[],sudo=false) {
      const result=await vm!.runCommand({cmd,args,sudo,timeoutMs:180_000});
      if(result.exitCode!==0)throw new Error(`Engine preparation failed: ${cmd}: ${(await result.stderr()).slice(-2000)}`);
      return (await result.stdout()).slice(-8000);
    }
    await checked('apt-get',['update'],true);
    await checked('apt-get',['install','-y','--no-install-recommends','libreoffice-writer','libreoffice-impress','libreoffice-calc','tesseract-ocr','tesseract-ocr-eng','tesseract-ocr-deu','fonts-crosextra-carlito','fonts-crosextra-caladea','fonts-liberation','fonts-noto-core','fonts-dejavu-core','python3-venv'],true);
    await checked('python3',['-m','venv','/vercel/sandbox/venv']);
    await checked('/vercel/sandbox/venv/bin/pip',['install','--requirement','/vercel/sandbox/requirements-test.lock']);
    await checked('/vercel/sandbox/venv/bin/python',['-m','unittest','test_engines.py','test_acceptance.py']);
    const engines=await checked('/vercel/sandbox/venv/bin/python',['-c',"import engines,json;print(json.dumps(engines.versions()))"]);
    const office=await checked('libreoffice',['--version']);
    const tesseract=await checked('tesseract',['--version']);
    const packages=await checked('dpkg-query',['-W','-f=${Package} ${Version}\\n','libreoffice*','tesseract*','fonts-crosextra*','fonts-liberation*','fonts-noto*']);
    const manifest=JSON.stringify({preparedAt:new Date().toISOString(),engines:JSON.parse(engines),office:office.trim(),tesseract:tesseract.trim(),packages,requirementsSha256:createHash('sha256').update(files[2].content).digest('hex'),sourceSha256:createHash('sha256').update(files[0].content).digest('hex')});
    await vm.writeFiles([{path:'/vercel/sandbox/engine-manifest.json',content:manifest}]);
    const snapshot=await vm.snapshot({expiration:7*24*60*60*1000});
    snapshotted=true;
    // Prove the prepared snapshot works with egress denied; never process a user file in the builder.
    const offline=await Sandbox.create({source:{type:'snapshot',snapshotId:snapshot.snapshotId},persistent:false,region:'fra1',resources:{vcpus:2},timeout:60_000,networkPolicy:'deny-all'});
    try {
      const test=await offline.runCommand('/vercel/sandbox/venv/bin/python',['-m','unittest','test_engines.py','test_acceptance.py'],{timeoutMs:45_000});
      if(test.exitCode!==0)throw new Error(`Offline engine tests failed: ${(await test.stderr()).slice(-2000)}`);
      const network=await offline.runCommand('python3',['-c',"import urllib.request,sys\ntry: urllib.request.urlopen('https://example.com',timeout=3)\nexcept Exception: print('egress-denied')\nelse: sys.exit(1)"],{timeoutMs:5000});
      if(network.exitCode!==0)throw new Error('Offline VM egress check failed');
    } finally { await offline.stop(); }
    const config={snapshotId:snapshot.snapshotId,verified:true,manifest:JSON.parse(manifest)};
    await writeFile(new URL('engine-snapshot.json',base),JSON.stringify(config,null,2)+'\n');
    console.log('DOCFLOW_ENGINE_SNAPSHOT',JSON.stringify(config));
  } finally {
    if(vm&&!snapshotted)await vm.stop();
  }
}
