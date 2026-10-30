import {expect,test,type Page} from '@playwright/test';
import {PDFDocument,StandardFonts,PDFRawStream,PDFName} from 'pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {readFile} from 'node:fs/promises';
import {pdfPixels} from './helpers/pdfPixels';
const base='/zubaer-ahmed-PDF-TEST/';
async function open(page:Page){const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);pdf.addPage([500,700]).drawText('Original contract text',{x:40,y:600,size:18,font});await page.goto(base+'#/tools/sign-visual');await expect(page.locator('[data-file-input]')).toBeVisible();await page.locator('[data-file-input]').setInputFiles({name:'contract.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});await expect(page.locator('.signature-drawing')).toBeVisible();}
test('typed signature can be placed, moved, undone and exported while preserving original selectable text',async({page})=>{
  await open(page);await page.locator('[name=signatureText]').fill('Zubaer Ahmed');await page.getByRole('button',{name:'Place typed signature',exact:true}).click();await expect(page.locator('.df2-edit-signature')).toHaveCount(1);
  await page.locator('[name=x]').fill('150');await page.locator('[name=x]').dispatchEvent('change');await expect(page.locator('[name=x]')).toHaveValue('150');
  await page.locator('[data-editor-undo]').click();await page.locator('[data-editor-redo]').click();await page.locator('[data-run]').click();await expect(page.locator('[data-pdf-review-status]')).toContainText('Page 1 / 1');
  const pending=page.waitForEvent('download');await page.locator('.df2-output').click();const output=await readFile((await(await pending).path())!);const pdf=await getDocument({data:new Uint8Array(output)}).promise;try{expect((await(await pdf.getPage(1)).getTextContent()).items.map(i=>'str'in i?i.str:'').join(' ')).toContain('Original contract text');}finally{await pdf.destroy();}
  const saved=await PDFDocument.load(output);expect(saved.context.enumerateIndirectObjects().some(([,object])=>object instanceof PDFRawStream&&object.dict.get(PDFName.of('Subtype'))?.toString()==='/Image')).toBe(true);
  const pixels=await pdfPixels(output,1);let ink=0;for(let y=140;y<205;y++)for(let x=150;x<370;x++){const offset=(y*pixels.width+x)*4;if(pixels.data[offset]!<180&&pixels.data[offset+1]!<180&&pixels.data[offset+2]!<180)ink++;}expect(ink).toBeGreaterThan(40);
  await page.goBack();await expect(page.locator('.df2-edit-signature')).toHaveCount(1);await expect(page.locator('[name=signatureText]')).toHaveValue('Zubaer Ahmed');
});
test('drawing is retained through browser navigation and can be placed without typing a name',async({page})=>{
  await open(page);const box=(await page.locator('.signature-drawing').boundingBox())!;await page.mouse.move(box.x+box.width*.1,box.y+box.height*.4);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+box.height*.7,{steps:10});await page.mouse.up();
  const before=await page.locator('.signature-drawing').evaluate((canvas:HTMLCanvasElement)=>canvas.toDataURL());
  const ink=()=>page.locator('.signature-drawing').evaluate((canvas:HTMLCanvasElement)=>{const pixels=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;let count=0,hash=2166136261;for(let i=3;i<pixels.length;i+=4){if(pixels[i])count++;hash=Math.imul(hash^pixels[i]!,16777619);}return {count,hash};});const beforeInk=await ink();expect(beforeInk.count).toBeGreaterThan(100);
  await page.goBack();await page.goForward();await expect(page.locator('.signature-drawing')).toHaveAttribute('aria-busy','false');await expect.poll(ink).toEqual(beforeInk);
  await page.getByRole('button',{name:'Place drawing',exact:true}).click();await expect(page.locator('.df2-edit-signature')).toHaveCount(1);
  expect(await page.locator('.df2-edit-signature img').evaluate((img:HTMLImageElement,original)=>img.getAttribute('src')===original,before)).toBe(true);
});
test('empty and unsupported typed marks fail clearly without adding a blank signature',async({page})=>{
  await open(page);await page.getByRole('button',{name:'Place drawing',exact:true}).click();await expect(page.locator('[data-run-status]')).toContainText('Draw');
  await page.locator('[name=signatureText]').fill('你好');await page.getByRole('button',{name:'Place typed signature',exact:true}).click();await expect(page.locator('[data-run-status]')).toContainText(/support|Draw/i);await expect(page.locator('.df2-edit-signature')).toHaveCount(0);
});
test('invisible typed input cannot create an empty signature image',async({page})=>{await open(page);for(const value of ['\u200b','\u00ad']){await page.locator('[name=signatureText]').fill(value);await page.getByRole('button',{name:'Place typed signature',exact:true}).click();await expect(page.locator('.df2-edit-signature')).toHaveCount(0);await expect(page.locator('[data-run-status]')).toContainText(/visible|name|draw/i);}});
test('starting over clears the prior document drawing instead of recapturing it',async({page})=>{
  await open(page);const canvas=page.locator('.signature-drawing');await canvas.scrollIntoViewIfNeeded();const box=(await canvas.boundingBox())!;await page.mouse.move(box.x+20,box.y+20);await page.mouse.down();await page.mouse.move(box.x+120,box.y+40,{steps:6});await page.mouse.up();
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Start over',exact:true}).click();await open(page);
  expect(await page.locator('.signature-drawing').evaluate((canvas:HTMLCanvasElement)=>{const data=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;let ink=0;for(let i=3;i<data.length;i+=4)if(data[i])ink++;return ink;})).toBe(0);
});
test('replacing the current PDF clears its prior drawing too',async({page})=>{
  await open(page);const pad=page.locator('.signature-drawing');await pad.scrollIntoViewIfNeeded();const box=(await pad.boundingBox())!;await page.mouse.move(box.x+20,box.y+20);await page.mouse.down();await page.mouse.move(box.x+110,box.y+40,{steps:6});await page.mouse.up();
  await page.evaluate(()=>{location.hash='#/tools/sign-visual';});await expect(page.locator('[data-file-input]')).toBeVisible();page.once('dialog',dialog=>dialog.accept());const next=await PDFDocument.create();next.addPage([500,700]);await page.locator('[data-file-input]').setInputFiles({name:'new.pdf',mimeType:'application/pdf',buffer:Buffer.from(await next.save())});await expect(page.locator('.signature-drawing')).toBeVisible();
  expect(await pad.evaluate((canvas:HTMLCanvasElement)=>{const data=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;let ink=0;for(let i=3;i<data.length;i+=4)if(data[i])ink++;return ink;})).toBe(0);
});
test('a PDF containing an existing certificate signature fails closed before visual placement',async({page})=>{
  const pdf=await PDFDocument.create();pdf.addPage();pdf.context.register(pdf.context.obj({Type:'Sig',ByteRange:[0,10,20,30]}));await page.goto(base+'#/tools/sign-visual');await page.locator('[data-file-input]').setInputFiles({name:'signed.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});await expect(page.locator('[data-run-status]')).toContainText('certificate signature');await expect(page.locator('[data-run]')).toBeDisabled();await expect(page.locator('.df2-edit-signature')).toHaveCount(0);
});
test('signature placement follows the canvas offset on a narrow page',async({page})=>{
  const pdf=await PDFDocument.create();pdf.addPage([100,1000]);await page.goto(base+'#/tools/sign-visual');await page.locator('[data-file-input]').setInputFiles({name:'narrow.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});await expect(page.locator('.signature-drawing')).toBeVisible();
  await page.locator('[data-fit]').click();await expect.poll(async()=>(await page.locator('[data-page-canvas]').boundingBox())!.width).toBeLessThan(100);await expect.poll(async()=>Math.abs((await page.locator('.df2-editor-overlay').boundingBox())!.width-(await page.locator('[data-page-canvas]').boundingBox())!.width)).toBeLessThan(1);
  const canvas=(await page.locator('[data-page-canvas]').boundingBox())!,overlay=(await page.locator('.df2-editor-overlay').boundingBox())!;expect(Math.abs(overlay.x-canvas.x)).toBeLessThan(1);expect(Math.abs(overlay.y-canvas.y)).toBeLessThan(1);
});
