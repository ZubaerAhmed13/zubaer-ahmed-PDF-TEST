import {expect,test,type Page} from '@playwright/test';
import {PDFDocument,StandardFonts,PDFName,degrees} from 'pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {pdfPixels} from './helpers/pdfPixels';
const base='/zubaer-ahmed-PDF-TEST/';
async function fixture(pages=2){
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);pdf.setTitle('SECRET-PRIVATE-TITLE');pdf.setAuthor('SECRET-PRIVATE-AUTHOR');
  for(let i=0;i<pages;i++){const p=pdf.addPage([550,700]);p.drawText('TOP SECRET DO NOT SHARE',{x:48,y:520,size:25,font});p.drawText('Visible public footer',{x:48,y:100,size:15,font});}
  const field=pdf.getForm().createTextField('PRIVATE-FIELD');field.setText('PRIVATE FORM VALUE');field.addToPage(pdf.getPage(0),{x:50,y:300,width:200,height:30});
  await pdf.attach(new TextEncoder().encode('PRIVATE ATTACHMENT'),'private.txt',{mimeType:'text/plain'});
  return {name:'secret.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())};
}
async function open(page:Page,pages=2){await page.goto(base+'#/tools/redact-secure');await expect(page.locator('[data-file-input]')).toBeVisible();await page.locator('[data-file-input]').setInputFiles(await fixture(pages));if(pages<=15)await expect(page.locator('[data-redact-layer]')).toBeVisible();}
async function mark(page:Page){for(const [name,value]of Object.entries({redactX:'5',redactY:'20',redactWidth:'90',redactHeight:'20'}))await page.locator(`[name=${name}]`).fill(value);await page.getByRole('button',{name:'Add area',exact:true}).click();}
test('requires explicit rasterization consent and exports reviewed bytes without original text, metadata or attachments',async({page},testInfo)=>{
  await open(page);await mark(page);await page.locator('[data-run]').click();await expect(page.locator('[data-run-status]')).toContainText('confirm');
  await page.locator('[name=confirmRasterization]').check();await page.locator('[data-run]').click();await expect(page.locator('[data-pdf-review-canvas]')).toBeVisible();
  await expect(page.locator('[data-pdf-review-status]')).toContainText('Page 1 / 2');
  const rendered=await page.locator('[data-pdf-review-canvas]').evaluate((canvas:HTMLCanvasElement)=>canvas.toDataURL().split(',')[1]!);
  await writeFile(testInfo.outputPath('redacted-output.png'),Buffer.from(rendered,'base64'));
  const pending=page.waitForEvent('download');await page.locator('.df2-output').click();const output=await readFile((await(await pending).path())!);
  const pdf=await PDFDocument.load(output);expect(pdf.getPageCount()).toBe(2);expect(pdf.getTitle()).not.toContain('SECRET');expect(pdf.getAuthor()).not.toContain('SECRET');expect(pdf.catalog.get(PDFName.of('Names'))).toBeUndefined();expect(pdf.getForm().getFields()).toHaveLength(0);
  const parsed=await getDocument({data:new Uint8Array(output)}).promise;try{for(let i=1;i<=2;i++)expect((await(await parsed.getPage(i)).getTextContent()).items).toHaveLength(0);}finally{await parsed.destroy();}
  expect(output.includes(Buffer.from('TOP SECRET'))).toBe(false);expect(output.includes(Buffer.from('PRIVATE ATTACHMENT'))).toBe(false);
  const pixels=await pdfPixels(output,1),at=(x:number,y:number)=>[...pixels.data.slice((y*pixels.width+x)*4,(y*pixels.width+x)*4+3)];expect(at(100,200)).toEqual([0,0,0]);expect(at(20,400)).toEqual([255,255,255]);
  await page.goBack();await expect(page.locator('[data-redact-count]')).toContainText('1 area');await expect(page.locator('[name=confirmRasterization]')).toBeChecked();
});
test('drawn masks, undo/redo and page changes retain the correct draft',async({page})=>{
  await open(page);const box=(await page.locator('[data-redact-layer]').boundingBox())!;await page.mouse.move(box.x+box.width*.1,box.y+box.height*.2);await page.mouse.down();await page.mouse.move(box.x+box.width*.6,box.y+box.height*.35,{steps:8});await page.mouse.up();
  await expect(page.locator('[data-redact-count]')).toContainText('1 area');await page.getByRole('button',{name:'Undo area change',exact:true}).click();await expect(page.locator('[data-redact-count]')).toContainText('0 areas');await page.getByRole('button',{name:'Redo area change',exact:true}).click();
  await page.locator('[data-page-next]').click();await expect(page.locator('[data-redact-layer] [data-redact-mask]')).toHaveCount(0);await mark(page);await expect(page.locator('[data-redact-count]')).toContainText('2 areas');
  await page.locator('[data-page-prev]').click();await expect(page.locator('[data-redact-layer] [data-redact-mask]')).toHaveCount(1);
});
test('refuses larger documents and cancellation keeps masks without publishing late output',async({page})=>{
  await open(page,16);await expect(page.locator('[data-run-status]')).toContainText('15 pages');await expect(page.locator('[data-redact-layer]')).toHaveCount(0);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Start over',exact:true}).click();
  await open(page);await mark(page);await page.locator('[name=confirmRasterization]').check();
  await page.evaluate(()=>{const read=File.prototype.arrayBuffer;let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});(window as unknown as {releaseRedaction:()=>void}).releaseRedaction=release;File.prototype.arrayBuffer=async function(){File.prototype.arrayBuffer=read;await gate;return read.call(this);};});
  await page.locator('[data-run]').click();await page.getByRole('button',{name:'Cancel processing'}).click();await page.evaluate(()=>(window as unknown as {releaseRedaction:()=>void}).releaseRedaction());await expect(page.locator('[data-redact-count]')).toContainText('1 area');await expect(page.locator('.df2-result')).toHaveCount(0);await expect(page.locator('[data-run-status]')).toContainText('Cancelled');
});
test('enforces the 40 MB limit from file metadata before reading bytes',async({page})=>{
  await page.addInitScript(()=>{const read=File.prototype.arrayBuffer;Object.defineProperty(File.prototype,'size',{get(){return 41*1048576;}});(window as unknown as {redactionReads:number}).redactionReads=0;File.prototype.arrayBuffer=function(){(window as unknown as {redactionReads:number}).redactionReads++;return read.call(this);};});
  await page.goto(base+'#/tools/redact-secure');await page.locator('[data-file-input]').setInputFiles(await fixture(1));await expect(page.locator('.df2-upload-note')).toContainText('40 MB');expect(await page.evaluate(()=>(window as unknown as {redactionReads:number}).redactionReads)).toBe(0);await expect(page.locator('.df2-work')).toHaveCount(0);
});
test('normalised regions align with the rendered crop and rotation in the actual export',async({page})=>{
  const source=await fixture(1),pdf=await PDFDocument.load(source.buffer);pdf.getPage(0).setCropBox(20,40,480,600);pdf.getPage(0).setRotation(degrees(90));
  await page.goto(base+'#/tools/redact-secure');await page.locator('[data-file-input]').setInputFiles({...source,buffer:Buffer.from(await pdf.save())});await expect(page.locator('[data-redact-layer]')).toBeVisible();await mark(page);await page.locator('[name=confirmRasterization]').check();await page.locator('[data-run]').click();await expect(page.locator('[data-pdf-review-status]')).toContainText('Page 1 / 1');
  const pending=page.waitForEvent('download');await page.locator('.df2-output').click();const output=await readFile((await(await pending).path())!),result=await PDFDocument.load(output);expect(result.getPages().map(p=>[p.getWidth(),p.getHeight()])).toEqual([[600,480]]);
  const pixels=await pdfPixels(output,1),offset=(Math.floor(pixels.height*.3)*pixels.width+Math.floor(pixels.width*.3))*4;expect([...pixels.data.slice(offset,offset+3)]).toEqual([0,0,0]);
});
test('short landscape pages keep the visual mask aligned with the exact canvas and exported pixels',async({page})=>{
  const pdf=await PDFDocument.create();pdf.addPage([1000,100]).drawText('Short page',{x:20,y:70,size:12});
  await page.goto(base+'#/tools/redact-secure');await page.locator('[data-file-input]').setInputFiles({name:'short.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});await expect(page.locator('[data-redact-layer]')).toBeVisible();await mark(page);
  const canvas=(await page.locator('[data-page-canvas]').boundingBox())!,overlay=(await page.locator('[data-redact-layer]').boundingBox())!,mask=(await page.locator('[data-redact-mask]').boundingBox())!;
  expect(Math.abs(overlay.height-canvas.height)).toBeLessThan(1);expect(Math.abs(mask.y-canvas.y-canvas.height*.2)).toBeLessThan(1);expect(Math.abs(mask.height-canvas.height*.2)).toBeLessThan(1);
  await page.locator('[name=confirmRasterization]').check();await page.locator('[data-run]').click();await expect(page.locator('[data-pdf-review-status]')).toContainText('Page 1 / 1');const pending=page.waitForEvent('download');await page.locator('.df2-output').click();const pixels=await pdfPixels(await readFile((await(await pending).path())!),1);const offset=(25*pixels.width+100)*4;expect([...pixels.data.slice(offset,offset+3)]).toEqual([0,0,0]);
});
test('a cancelled drag removes its temporary black mask before export is allowed',async({page})=>{
  await open(page);await mark(page);const box=(await page.locator('[data-redact-layer]').boundingBox())!;
  await page.mouse.move(box.x+box.width*.1,box.y+box.height*.2);await page.mouse.down();await page.mouse.move(box.x+box.width*.4,box.y+box.height*.35,{steps:6});await expect(page.locator('[data-redact-mask]')).toHaveCount(2);
  await page.locator('[data-redact-layer]').dispatchEvent('pointercancel');await page.mouse.up();await expect(page.locator('[data-redact-mask]')).toHaveCount(1);await expect(page.locator('[data-redact-count]')).toContainText('1 area');
});
