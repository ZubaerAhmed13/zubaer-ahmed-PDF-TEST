import {expect,test,type Page} from '@playwright/test';
import {PDFDocument,rgb,pushGraphicsState,popGraphicsState,concatTransformationMatrix,drawObject} from 'pdf-lib';
import JSZip from 'jszip';
import {readFile} from 'node:fs/promises';
const base='/zubaer-ahmed-PDF-TEST/';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGElEQVR4nAXBAQEAAAjDIG7/zhNE0k3CAz7tBf5/xlWuAAAAAElFTkSuQmCC','base64');
async function fixture(withImages=true){
  const pdf=await PDFDocument.create(),image=withImages?await pdf.embedPng(png):null;
  for(let i=0;i<2;i++){const p=pdf.addPage([300,400]);p.drawText('Text and vector content',{x:20,y:360});p.drawRectangle({x:20,y:20,width:50,height:40,color:rgb(0,1,0)});if(image){p.drawImage(image,{x:40,y:80,width:100,height:100});p.drawImage(image,{x:160,y:80,width:100,height:100});}}
  return {name:'embedded.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())};
}
async function open(page:Page,withImages=true){
  await page.goto(base+'#/tools/extract-images');await page.locator('[data-file-input]').setInputFiles(await fixture(withImages));
  await expect(page.locator('[data-page-label]')).toContainText('/ 2');
}
test('reviews true embedded rasters and downloads pixel-equivalent PNGs and a truthful ZIP manifest',async({page},testInfo)=>{
  await open(page);await page.locator('[data-run]').click();await expect(page.locator('.df2-result')).toBeVisible();
  await expect(page.getByRole('heading',{name:'Extracted images'})).toBeVisible();
  await expect(page.locator('[data-image-detail]')).toContainText('Page 1 · 2 × 2 px');
  await page.getByRole('button',{name:'Next image',exact:true}).click();await expect(page.locator('[data-image-detail]')).toContainText('Page 2 · 2 × 2 px');
  await expect(page.locator('[data-image-detail] img')).toHaveCount(1);
  await page.locator('[data-image-detail] img').evaluate((image:HTMLImageElement)=>image.decode());
  await page.screenshot({path:testInfo.outputPath('extracted-image-review.png'),fullPage:true});
  const individual=page.waitForEvent('download');await page.getByRole('link',{name:'Download this PNG'}).click();expect((await individual).suggestedFilename()).toBe('page-002-image-001.png');
  const pending=page.waitForEvent('download');await page.locator('.df2-output').click();const file=(await pending);const zip=await JSZip.loadAsync(await readFile((await file.path())!));
  const manifest=JSON.parse(await zip.file('manifest.json')!.async('string')) as {extractedImages:number;note:string;images:{page:number;width:number;height:number;filename:string}[]};
  expect(manifest.extractedImages).toBe(2);expect(manifest.images.map(i=>[i.page,i.width,i.height])).toEqual([[1,2,2],[2,2,2]]);expect(manifest.note).toContain('Original JPEG/JPX');
  const extracted=Buffer.from(await zip.file(manifest.images[0]!.filename)!.async('uint8array'));
  const pixels=await page.evaluate(async({source,result})=>{
    const decode=async(data:string)=>{const blob=new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'image/png'}),bitmap=await createImageBitmap(blob);const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const ctx=c.getContext('2d')!;ctx.drawImage(bitmap,0,0);bitmap.close();return {width:c.width,height:c.height,pixels:[...ctx.getImageData(0,0,c.width,c.height).data]};};
    return {source:await decode(source),result:await decode(result)};
  },{source:png.toString('base64'),result:extracted.toString('base64')});expect(pixels.result).toEqual(pixels.source);
  const activeUrl=await page.locator('[data-image-detail] img').getAttribute('src');
  const canLoad=(url:string)=>page.evaluate(src=>new Promise<boolean>(resolve=>{const image=new Image();image.onload=()=>resolve(true);image.onerror=()=>resolve(false);image.src=src;}),url);
  expect(await canLoad(activeUrl!)).toBe(true);
  await page.goBack();await expect(page.locator('[data-run]')).toBeEnabled();expect(await canLoad(activeUrl!)).toBe(false);
  await page.goForward();await expect(page.locator('[data-image-detail] img')).toBeVisible();
});
test('reports a text/vector-only PDF without producing page screenshots as extracted images',async({page})=>{
  await open(page,false);await page.locator('[data-run]').click();await expect(page.locator('[data-run-status]')).toContainText('No decoded embedded raster images');
  await expect(page.locator('.df2-result')).toHaveCount(0);await expect(page.locator('[data-run]')).toBeEnabled();
});
test('discloses skipped masks and preserves a narrow one-bit grayscale raster',async({page})=>{
  const pdf=await PDFDocument.create(),p=pdf.addPage([300,400]),image=await pdf.embedPng(png);p.drawImage(image,{x:10,y:10,width:50,height:50});
  for(const mask of [false,true]){
    const stream=pdf.context.flateStream(Uint8Array.from([128,0]),{Type:'XObject',Subtype:'Image',Width:1,Height:2,BitsPerComponent:1,...(mask?{ImageMask:true}:{ColorSpace:'DeviceGray'})});
    const key=p.node.newXObject(mask?'Mask':'Mono',pdf.context.register(stream));p.pushOperators(pushGraphicsState(),concatTransformationMatrix(20,0,0,40,mask?160:100,100),drawObject(key),popGraphicsState());
  }
  await page.goto(base+'#/tools/extract-images');await page.locator('[data-file-input]').setInputFiles({name:'masks.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});await page.locator('[data-run]').click();
  await expect(page.locator('.df2-review-warning')).toContainText('skipped');await page.getByRole('combobox',{name:'Extracted image',exact:true}).selectOption('1');
  await expect(page.locator('[data-image-detail]')).toContainText('1 × 2 px');
  const pixels=await page.locator('[data-image-detail] img').evaluate(async(el:HTMLImageElement)=>{await el.decode();const c=document.createElement('canvas');c.width=el.naturalWidth;c.height=el.naturalHeight;const ctx=c.getContext('2d')!;ctx.drawImage(el,0,0);return [...ctx.getImageData(0,0,c.width,c.height).data];});
  expect(pixels).toEqual([255,255,255,255,0,0,0,255]);
  const pending=page.waitForEvent('download');await page.locator('.df2-output').click();const zip=await JSZip.loadAsync(await readFile((await(await pending).path())!));const manifest=JSON.parse(await zip.file('manifest.json')!.async('string'));
  expect(manifest.skippedRasterOperations).toBeGreaterThan(0);expect(manifest.skipped[0].reason).toContain('mask');
});
test('cancelling extraction during input preparation keeps the document and ignores late bytes',async({page})=>{
  await open(page);await page.evaluate(()=>{const read=File.prototype.arrayBuffer;let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});(window as unknown as {releaseRead:()=>void}).releaseRead=release;File.prototype.arrayBuffer=async function(){File.prototype.arrayBuffer=read;await gate;return read.call(this);};});
  await page.locator('[data-run]').click();await page.getByRole('button',{name:'Cancel processing'}).click();await page.evaluate(()=>(window as unknown as {releaseRead:()=>void}).releaseRead());
  await expect(page.locator('[data-run-status]')).toContainText('Cancelled');await expect(page.locator('.df2-file')).toHaveCount(1);await expect(page.locator('.df2-result')).toHaveCount(0);await expect(page.locator('[data-run]')).toBeEnabled();
});
test('rejects an oversized native image instead of quietly exporting a downscaled copy',async({page})=>{
  const pdf=await PDFDocument.create(),p=pdf.addPage([300,400]),width=4100,height=4100;
  const stream=pdf.context.flateStream(new Uint8Array(width*height*3).fill(127),{Type:'XObject',Subtype:'Image',Width:width,Height:height,BitsPerComponent:8,ColorSpace:'DeviceRGB'});
  const key=p.node.newXObject('Large',pdf.context.register(stream));p.pushOperators(pushGraphicsState(),concatTransformationMatrix(200,0,0,200,20,20),drawObject(key),popGraphicsState());
  await page.goto(base+'#/tools/extract-images');await page.locator('[data-file-input]').setInputFiles({name:'large-raster.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});await page.locator('[data-run]').click();
  await expect(page.locator('[data-run-status]')).toContainText('16-million-pixel');await expect(page.locator('.df2-result')).toHaveCount(0);await expect(page.locator('[data-run]')).toBeEnabled();
});
