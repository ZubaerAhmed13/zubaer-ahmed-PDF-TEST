import {expect,test} from '@playwright/test';
import {PDFDocument} from 'pdf-lib';
const base='/zubaer-ahmed-PDF-TEST/';
async function fixture(name:string){const pdf=await PDFDocument.create();pdf.addPage();return {name,mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())};}
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    const size=Object.getOwnPropertyDescriptor(Blob.prototype,'size')!.get!,read=File.prototype.arrayBuffer;
    Object.defineProperty(File.prototype,'size',{get(){return this.name==='oversized.pdf'?151*1048576:this.name.startsWith('large-')?140*1048576:size.call(this);}});
    (window as unknown as {fileReads:string[]}).fileReads=[];
    File.prototype.arrayBuffer=function(){(window as unknown as {fileReads:string[]}).fileReads.push(this.name);return read.call(this);};
  });
  await page.goto(base+'#/tools/merge');
});
test('rejects an oversized file before reading bytes or opening a workspace',async({page})=>{
  await page.locator('[data-file-input]').setInputFiles(await fixture('oversized.pdf'));
  await expect(page.locator('.df2-upload-note')).toContainText('150 MB');
  await expect(page.locator('.df2-work')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as unknown as {fileReads:string[]}).fileReads)).toEqual([]);
});
test('checks the combined budget before reading an addition and keeps accepted files',async({page})=>{
  await page.locator('[data-file-input]').setInputFiles(await fixture('large-first.pdf'));
  await expect(page.locator('.df2-file')).toHaveCount(1);
  await page.locator('[data-add-file]').setInputFiles(await fixture('large-second.pdf'));
  await expect(page.locator('[data-run-status]')).toContainText('250 MB');
  await expect(page.locator('.df2-file')).toHaveCount(1);
  expect(await page.evaluate(()=>(window as unknown as {fileReads:string[]}).fileReads)).not.toContain('large-second.pdf');
});
