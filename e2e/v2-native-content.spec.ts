import {expect,test,type Page} from '@playwright/test';
import {PDFDocument,PDFName,PDFNumber,PDFRawStream,decodePDFRawStream,StandardFonts} from 'pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {readFile} from 'node:fs/promises';
const base='/zubaer-ahmed-PDF-TEST/';
test('source selection follows the canvas offset on a narrow page',async({page})=>{
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);pdf.addPage([100,1000]).drawText('Hi',{x:10,y:900,size:12,font});await page.goto(base+'#/tools/edit-pdf');await page.locator('[data-file-input]').setInputFiles({name:'narrow-source.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});await page.locator('[data-source-toggle]').click();await expect(page.locator('.df2-source-list')).toContainText('Hi');
  await page.locator('[data-fit]').click();await expect.poll(async()=>(await page.locator('[data-page-canvas]').boundingBox())!.width).toBeLessThan(100);await expect.poll(async()=>Math.abs((await page.locator('.df2-native-overlay').boundingBox())!.width-(await page.locator('[data-page-canvas]').boundingBox())!.width)).toBeLessThan(1);
  const canvas=(await page.locator('[data-page-canvas]').boundingBox())!,overlay=(await page.locator('.df2-native-overlay').boundingBox())!;expect(Math.abs(overlay.x-canvas.x)).toBeLessThan(1);expect(Math.abs(overlay.y-canvas.y)).toBeLessThan(1);
});
async function open(page:Page,pageCount=1){
  const doc=await PDFDocument.create(),p=doc.addPage([500,700]),font=await doc.embedFont(StandardFonts.Helvetica);
  p.drawText('Original source text',{x:50,y:620,size:18,font});p.drawText('Unchanged text',{x:50,y:540,size:14,font});
  for(let i=1;i<pageCount;i++)doc.addPage([500,700]).drawText('Second page text',{x:50,y:620,size:18,font});
  await page.goto(base+'#/tools/edit-pdf');await page.locator('[data-file-input]').setInputFiles({name:'native.pdf',mimeType:'application/pdf',buffer:Buffer.from(await doc.save())});
  await expect(page.locator('[data-source-toggle]')).toBeVisible();await page.locator('[data-source-toggle]').click();
  await page.locator('[data-source-select]').filter({hasText:'Original source text'}).click();
}
async function outputBytes(page:Page){
  await page.locator('[data-run]').click();await expect(page.locator('.df2-result')).toBeVisible();
  const pending=page.waitForEvent('download');await page.locator('.df2-output').click();const path=await(await pending).path();
  return readFile(path!);
}
async function outputText(page:Page){
  const pdf=await getDocument({data:new Uint8Array(await outputBytes(page)),standardFontDataUrl:new URL('../node_modules/pdfjs-dist/standard_fonts/',import.meta.url).pathname}).promise;
  try{return(await(await pdf.getPage(1)).getTextContent()).items.map(v=>'str'in v?v.str:'').join(' ');}finally{await pdf.destroy();}
}
test('replaces source text in the rendered PDF and in selectable exported text',async({page})=>{
  await open(page);const before=await page.locator('[data-page-canvas]').evaluate((c:HTMLCanvasElement)=>c.toDataURL());
  await page.locator('[name=nativeText]').fill('Updated source text');await page.locator('[data-source-apply]').click();
  await expect(page.locator('[data-native-preview-status]')).toHaveText('Source changes previewed');
  expect(await page.locator('[data-page-canvas]').evaluate((c:HTMLCanvasElement)=>c.toDataURL())).not.toBe(before);
  await page.locator('[data-editor-add=text]').click();await page.locator('[name=editorText]').fill('Added note');await page.locator('[name=editorText]').dispatchEvent('change');
  const text=await outputText(page);expect(text).toContain('Updated source text');expect(text).not.toContain('Original source text');expect(text).toContain('Added note');expect(text).toContain('Unchanged text');
});
test('shares undo and redo with source changes and retains pending typing across history navigation',async({page})=>{
  await open(page);await page.locator('[name=nativeText]').fill('Pending text');
  await page.evaluate(()=>{location.hash='#/tools/edit-pdf';});await expect(page.locator('[data-file-input]')).toBeVisible();
  await page.goBack();await expect(page.locator('[name=nativeText]')).toHaveValue('Pending text');
  await page.locator('[data-source-apply]').click();await expect(page.locator('[data-native-preview-status]')).toHaveText('Source changes previewed');
  await page.locator('[data-editor-undo]').click();await expect(page.locator('[data-native-preview-status]')).toHaveText('Source changes previewed');
  expect(await outputText(page)).toContain('Original source text');
  await page.locator('[data-return-edit]').click();await page.locator('[data-editor-redo]').click();await expect(page.locator('[data-native-preview-status]')).toHaveText('Source changes previewed');
  const text=await outputText(page);expect(text).toContain('Pending text');expect(text).not.toContain('Original source text');
});
test('rejects unsupported characters with original font and permits an explicit supported substitute',async({page})=>{
  await open(page);await page.locator('[name=nativeText]').fill('Résumé Αθήνα Привет');await page.locator('[data-source-apply]').click();
  await expect(page.locator('[data-source-status]')).toContainText('font');
  await page.locator('[name=nativeFont]').selectOption('docflow');await page.locator('[name=nativeText]').fill('你好');await page.locator('[data-source-apply]').click();
  await expect(page.locator('[data-source-status]')).toContainText('script');
  await page.locator('[name=nativeText]').fill('Résumé Αθήνα Привет');await page.locator('[data-source-apply]').click();
  await expect(page.locator('[data-native-preview-status]')).toHaveText('Source changes previewed');expect(await outputText(page)).toContain('Résumé Αθήνα Привет');
});
test('replaces only the selected shared image and preserves its placement',async({page})=>{
  const doc=await PDFDocument.create(),p=doc.addPage([500,700]),png=await doc.embedPng(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3foAAAAASUVORK5CYII=','base64'));
  p.drawImage(png,{x:40,y:200,width:100,height:100});p.drawImage(png,{x:240,y:200,width:100,height:100});p.drawText('Retain text',{x:40,y:600});
  await page.goto(base+'#/tools/edit-pdf');await page.locator('[data-file-input]').setInputFiles({name:'images.pdf',mimeType:'application/pdf',buffer:Buffer.from(await doc.save())});
  await page.locator('[data-source-toggle]').click();await page.locator('.df2-source-list [data-source-select]').filter({hasText:'Image'}).first().click();
  const replacement=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=16;const ctx=c.getContext('2d')!;ctx.fillStyle='#ff0000';ctx.fillRect(0,0,16,16);return c.toDataURL().split(',')[1]!;});
  await page.locator('[data-source-image]').setInputFiles({name:'red.png',mimeType:'image/png',buffer:Buffer.from(replacement,'base64')});
  await expect(page.locator('[data-native-preview-status]')).toHaveText('Source changes previewed');
  const saved=await PDFDocument.load(await outputBytes(page)),images=saved.context.enumerateIndirectObjects().map(([,v])=>v).filter(v=>v instanceof PDFRawStream&&v.dict.get(PDFName.of('Subtype'))?.toString()==='/Image') as PDFRawStream[];
  const changed=images.find(v=>v.dict.lookup(PDFName.of('Width'),PDFNumber).asNumber()===16&&v.dict.get(PDFName.of('ColorSpace'))?.toString()==='/DeviceRGB');
  expect(changed).toBeDefined();expect([...decodePDFRawStream(changed!).decode().slice(0,3)]).toEqual([255,0,0]);expect(images.some(v=>v.dict.lookup(PDFName.of('Width'),PDFNumber).asNumber()===1)).toBe(true);
});
test('requires applying pending source text before export',async({page})=>{
  await open(page);await page.locator('[name=nativeText]').fill('Pending replacement');await page.locator('[data-run]').click();
  await expect(page.locator('[data-run-status]')).toContainText('Apply');await expect(page.locator('.df2-work')).toBeVisible();
});
test('source selection and validation keep keyboard focus without stealing it from another control',async({page})=>{
  await open(page);
  const selected=page.locator('.df2-source-list [data-source-select]').filter({hasText:'Original source text'});
  await selected.focus();await selected.press('Enter');await expect(selected).toBeFocused();
  await page.locator('[name=nativeText]').fill('Updated source text');
  const apply=page.locator('[data-source-apply]');await apply.focus();await apply.press('Enter');
  await expect(page.locator('[data-source-status]')).toContainText('Source change applied');await expect(apply).toBeFocused();
  const overlay=page.locator('.df2-native-overlay [data-source-select]').first();await overlay.focus();
  await page.locator('[data-page-canvas]').evaluate(c=>c.dispatchEvent(new Event('docflow-page-rendered')));await expect(overlay).toBeFocused();
  await page.evaluate(()=>{
    const original=File.prototype.arrayBuffer;let release!:()=>void;
    const gate=new Promise<void>(r=>{release=r;});
    (window as unknown as {releaseSourceRead:()=>void}).releaseSourceRead=release;
    File.prototype.arrayBuffer=async function(){File.prototype.arrayBuffer=original;await gate;return original.call(this);};
  });
  await page.locator('[name=nativeText]').fill('Second source change');await apply.click();
  await expect(page.getByRole('region',{name:'Existing PDF content'})).toHaveAttribute('aria-busy','true');
  await expect(page.getByRole('region',{name:'Existing PDF content'})).toBeFocused();
  await page.locator('[data-zoom-in]').focus();
  await page.evaluate(()=>(window as unknown as {releaseSourceRead:()=>void}).releaseSourceRead());
  await expect(page.locator('[data-source-status]')).toContainText('Source change applied');await expect(page.locator('[data-zoom-in]')).toBeFocused();
});
test('source-panel refresh retains pending text and a backward caret selection',async({page})=>{
  await open(page);const input=page.locator('[name=nativeText]');await input.fill('Pending source typing');
  await input.evaluate((el:HTMLInputElement)=>{el.focus();el.setSelectionRange(2,8,'backward');});
  await page.locator('[data-editor-add=rectangle]').dispatchEvent('click');
  await expect(input).toBeFocused();await expect(input).toHaveValue('Pending source typing');
  expect(await input.evaluate((el:HTMLInputElement)=>[el.selectionStart,el.selectionEnd,el.selectionDirection])).toEqual([2,8,'backward']);
});
test('page navigation cancels validation without locking further source editing',async({page})=>{
  await open(page,2);await page.locator('[name=nativeText]').fill('Updated source text');await page.locator('[data-source-apply]').click();
  await page.locator('[data-page-next]').click();await expect(page.locator('.df2-source-list')).toContainText('Second page text');
  await page.locator('[data-page-prev]').click();await page.locator('.df2-source-list [data-source-select]').filter({hasText:'Original source text'}).click();
  await expect(page.locator('[data-source-apply]')).toBeEnabled();await page.locator('[data-source-apply]').click();
  await expect(page.locator('[data-native-preview-status]')).toHaveText('Source changes previewed');expect(await outputText(page)).toContain('Updated source text');
});
