import {test as baseTest,expect,type Page} from '@playwright/test';
import {createServer} from 'node:http';
import {resolve,sep} from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {readFile} from 'node:fs/promises';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
const base='/zubaer-ahmed-PDF-TEST/';
interface LocalOrigin {
  url: string;
  close: () => Promise<void>;
}

const test=baseTest.extend<{offlineOrigin:LocalOrigin}>({
  offlineOrigin:async({browserName},use)=>{
    // Closing the origin also blocks service-worker network requests, which
    // can bypass page-level offline emulation in Chromium.
    const dist=resolve('dist');
    const types:Record<string,string>={
      html:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css',
      json:'application/json',wasm:'application/wasm',webmanifest:'application/manifest+json',
      svg:'image/svg+xml',png:'image/png',woff:'font/woff',
    };
    const server=createServer(async(request,response)=>{
      try{
        const path=new URL(request.url!,'http://127.0.0.1').pathname;
        if(!path.startsWith(base)){response.writeHead(404).end();return;}
        const file=resolve(dist,path.slice(base.length)||'index.html');
        if(!file.startsWith(dist+sep)){response.writeHead(404).end();return;}
        const bytes=await readFile(file);
        response.writeHead(200,{'cache-control':'no-store','content-type':types[file.split('.').at(-1)!]??'application/octet-stream'});
        response.end(bytes);
      }catch{response.writeHead(404).end();}
    });
    const close=()=>new Promise<void>((done,reject)=>{
      if(!server.listening){done();return;}
      server.close(error=>error?reject(error):done());
      server.closeAllConnections();
    });
    try{
      await new Promise<void>((done,reject)=>{
        server.once('error',reject);
        server.listen(0,'127.0.0.1',done);
      });
      const address=server.address();
      if(!address||typeof address==='string')throw Error('Missing offline test origin for '+browserName);
      await use({url:`http://127.0.0.1:${address.port}${base}`,close});
    }finally{await close();}
  },
});

async function ready(page:Page,url=base){
  await page.goto(url);
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker?.controller),undefined,{timeout:45000});
  await page.getByRole('button',{name:'Offline and storage',exact:true}).click();
  await expect(page.locator('[data-offline-state=core]')).toContainText('Ready in this browser',{timeout:30000});
}
async function closePanel(page:Page){await page.getByRole('button',{name:'Close offline and storage'}).click();await expect(page.getByRole('dialog',{name:'Offline and storage'})).toHaveCount(0);}
async function disconnect(page:Page,origin:LocalOrigin){
  await origin.close();
  await page.addInitScript(()=>Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false}));
  await page.reload();
  await expect(page.locator('.df2-home')).toBeVisible();
  expect(await page.evaluate(async()=>{
    try{await fetch('./offline-probe?test='+Date.now(),{cache:'no-store'});return false;}
    catch{return true;}
  })).toBe(true);
}
async function output(page:Page,name:string){const pending=page.waitForEvent('download');await page.locator('.df2-output').filter({hasText:name}).click();const path=await(await pending).path();if(!path)throw Error('Missing offline output');return readFile(path);}
test('prepared v2 core survives offline reload and exports real rotated bytes',async({page,offlineOrigin})=>{
  test.setTimeout(120000);await page.setViewportSize({width:390,height:844});await ready(page,offlineOrigin.url);await closePanel(page);
  await disconnect(page,offlineOrigin);
  await page.locator('[data-card-tool=rotate]').click();const pdf=await PDFDocument.create();pdf.addPage([401,580]);await page.locator('[data-file-input]').setInputFiles({name:'offline.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});
  await page.getByRole('button',{name:'Options',exact:true}).click();await page.getByRole('combobox',{name:'Rotation',exact:true}).selectOption('180');await page.locator('[data-run]').click();await expect(page.locator('.df2-result')).toBeVisible();const actual=await PDFDocument.load(await output(page,'rotated.pdf'));expect(actual.getPage(0).getRotation().angle).toBe(180);expect(actual.getPage(0).getWidth()).toBe(401);
});
test('prepared English OCR recognises a scan offline and missing assets fail visibly',async({page,offlineOrigin})=>{
  test.setTimeout(180000);await ready(page,offlineOrigin.url);await page.getByRole('button',{name:'Prepare English OCR',exact:true}).click();await expect(page.locator('[data-offline-state=eng]')).toContainText('Ready in this browser',{timeout:90000});await closePanel(page);
  const png=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=320;const ctx=canvas.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,1000,320);ctx.fillStyle='black';ctx.font='bold 90px Arial';ctx.fillText('DOCFLOW OFFLINE OCR',30,180);return canvas.toDataURL('image/png').split(',')[1]!;});
  const pdf=await PDFDocument.create(),picture=await pdf.embedPng(Buffer.from(png,'base64'));pdf.addPage([500,160]).drawImage(picture,{x:0,y:0,width:500,height:160});const source={name:'scan.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())};
  await disconnect(page,offlineOrigin);
  await page.locator('[data-card-tool=ocr]').click();await page.locator('[data-file-input]').setInputFiles(source);const options=page.getByRole('button',{name:'Options',exact:true});if(await options.isVisible())await options.click();await page.locator('[data-run]').click();await expect(page.locator('.df2-result')).toBeVisible({timeout:110000});
  const task=getDocument({data:new Uint8Array(await output(page,'searchable-ocr.pdf'))}),actual=await task.promise;try{const content=await(await actual.getPage(1)).getTextContent();expect(content.items.map(i=>'str'in i?i.str:'').join(' ').toUpperCase()).toContain('OFFLINE');}finally{await actual.destroy();}
  await page.getByRole('button',{name:'Return to editing'}).click();
  await page.evaluate(async()=>{const manifest=await(await fetch('./offline-manifest.json')).json() as {ocrCache:string;groups:{eng:{path:string}[]}};const model=manifest.groups.eng.find(a=>a.path.endsWith('/eng.traineddata'))!;await(await caches.open(manifest.ocrCache)).delete(new URL(model.path,location.href).href,{ignoreVary:true});Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});});
  await page.locator('[data-run]').click();await expect(page.locator('[data-run-status]')).toContainText('Offline OCR assets are missing',{timeout:30000});await expect(page.locator('.df2-file')).toContainText('scan.pdf');
});
test('actual worker update query refuses to replace a v2 tab with retained work',async({page,context})=>{
  test.setTimeout(90000);await ready(page);await closePanel(page);await page.locator('[data-card-tool=rotate]').click();const pdf=await PDFDocument.create();pdf.addPage([400,580]);await page.locator('[data-file-input]').setInputFiles({name:'keep.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});await expect(page.locator('[data-page-label]')).toContainText('/ 1');
  const second=await context.newPage();await second.goto(base);await second.waitForFunction(()=>Boolean(navigator.serviceWorker?.controller));
  const query=()=>second.evaluate(()=>new Promise<string>((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Worker did not acknowledge update query')),7000);const onMessage=(event:MessageEvent)=>{if(!['DOCFLOW_UPDATE_BLOCKED','DOCFLOW_UPDATE_ACCEPTED'].includes(event.data?.type))return;clearTimeout(timeout);navigator.serviceWorker.removeEventListener('message',onMessage);resolve(event.data.type);};navigator.serviceWorker.addEventListener('message',onMessage);navigator.serviceWorker.controller!.postMessage({type:'SKIP_WAITING'});}));
  expect(await query()).toBe('DOCFLOW_UPDATE_BLOCKED');await expect(page.locator('.df2-file')).toContainText('keep.pdf');page.once('dialog',dialog=>void dialog.accept());await page.locator('[data-reset]').click();await expect(page.locator('.df2-dropbox')).toBeVisible();expect(await query()).toBe('DOCFLOW_UPDATE_ACCEPTED');await second.close();
});
