import {expect,test,type Page} from '@playwright/test';
import {PDFDocument,StandardFonts,degrees} from 'pdf-lib';
import {readFile} from 'node:fs/promises';
const base='/zubaer-ahmed-PDF-TEST/';
async function open(page:Page){
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
  for(let i=1;i<=3;i++){const p=pdf.addPage([400,600]);p.drawText('Reader page '+i+' selectable text',{x:30,y:530,size:18,font});if(i===2)p.setRotation(degrees(90));}
  const source=Buffer.from(await pdf.save());await page.goto(base+'#/tools/preview');await expect(page.locator('[data-file-input]')).toBeVisible();
  await page.locator('[data-file-input]').setInputFiles({name:'reader.pdf',mimeType:'application/pdf',buffer:source});await expect(page.locator('[data-reader-layer]')).toContainText('Reader page 1');return source;
}
test('reader exposes actual selectable PDF text and keeps it aligned when phone zoom changes',async({page})=>{
  await page.setViewportSize({width:390,height:844});await open(page);
  const select=()=>page.locator('[data-reader-layer] span').filter({hasText:'Reader page 1'}).first();
  const before=(await select().boundingBox())!.width;
  const box=(await select().boundingBox())!;await page.mouse.move(box.x+1,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width-1,box.y+box.height/2,{steps:12});await page.mouse.up();
  expect((await page.evaluate(()=>window.getSelection()?.toString()))?.length).toBeGreaterThan(10);
  await select().evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);});
  expect(await page.evaluate(()=>window.getSelection()?.toString())).toContain('Reader page 1 selectable text');
  await page.locator('[data-zoom-in]').click();await expect.poll(async()=>(await select().boundingBox())?.width??0).toBeGreaterThan(before*1.1);
  await expect(page.locator('[data-reader-layer]')).toHaveCount(1);
  const bounds=await page.locator('[data-reader-layer]').boundingBox(),canvas=await page.locator('[data-page-canvas]').boundingBox();expect(Math.abs(bounds!.width-canvas!.width)).toBeLessThan(2);expect(Math.abs(bounds!.height-canvas!.height)).toBeLessThan(2);
});
test('page entry navigates rotated pages and rejects an out-of-range number without losing the page',async({page})=>{
  await open(page);const input=page.getByRole('spinbutton',{name:'Page number',exact:true});await input.fill('2');await input.press('Enter');
  await expect(page.locator('[data-reader-layer]')).toContainText('Reader page 2');await expect(page.locator('[data-reader-layer]')).not.toContainText('Reader page 1');
  const layer=await page.locator('[data-reader-layer]').boundingBox(),canvas=await page.locator('[data-page-canvas]').boundingBox();expect(Math.abs(layer!.width-canvas!.width)).toBeLessThan(2);expect(Math.abs(layer!.height-canvas!.height)).toBeLessThan(2);
  await input.fill('9');await page.getByRole('button',{name:'Go to page',exact:true}).click();await expect(page.locator('[data-reader-status]')).toContainText('1–3');await expect(page.locator('[data-page-label]')).toContainText('Page 2 / 3');
  await input.fill('3');await page.getByRole('button',{name:'Go to page',exact:true}).click();await expect(page.locator('[data-reader-layer]')).toContainText('Reader page 3');
});
test('reader downloads the exact original and restores text selection after browser Back',async({page})=>{
  const source=await open(page);await page.getByRole('button',{name:'Download original',exact:true}).click();await expect(page.locator('.df2-result')).toBeVisible();
  await expect(page.locator('canvas.hiddenCanvasElement')).toHaveCount(0);
  const pending=page.waitForEvent('download');await page.locator('.df2-output').click();expect(await readFile((await(await pending).path())!)).toEqual(source);
  await page.goBack();await expect(page.locator('[data-reader-layer]')).toHaveCount(1);await expect(page.locator('[data-reader-layer]')).toContainText('Reader page 1 selectable text');
});
test('rapid reader navigation cancels the obsolete PDF.js text stream',async({page})=>{
  await open(page);
  await page.evaluate(()=>{
    const send=Worker.prototype.postMessage;
    const state={first:null as string|null,cancels:[] as string[]};(window as unknown as {readerStreams:typeof state}).readerStreams=state;
    Worker.prototype.postMessage=function(message,...rest){
      send.apply(this,[message,...rest] as Parameters<Worker['postMessage']>);
      const packet=message as {action?:string;sourceName?:string;targetName?:string;streamId?:number;stream?:number};
      const key=[packet.sourceName,packet.targetName,packet.streamId].join(':');
      if(packet.stream===1)state.cancels.push(key);
      if(packet.action==='GetTextContent'&&!state.first){state.first=key;queueMicrotask(()=>{const input=document.querySelector<HTMLInputElement>('[name=readerPage]')!;input.value='3';input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));});}
    };
  });
  await page.locator('[data-page-next]').click();await expect(page.locator('[data-reader-layer]')).toContainText('Reader page 3');
  await expect.poll(()=>page.evaluate(()=>{const state=(window as unknown as {readerStreams:{first:string|null;cancels:string[]}}).readerStreams;return state.first!==null&&state.cancels.includes(state.first);})).toBe(true);
});
test('a scan-only page is readable without promising selectable or recognised text',async({page})=>{
  const pdf=await PDFDocument.create(),image=await pdf.embedPng(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGElEQVR4nAXBAQEAAAjDIG7/zhNE0k3CAz7tBf5/xlWuAAAAAElFTkSuQmCC','base64'));
  pdf.addPage([400,600]).drawImage(image,{x:20,y:20,width:200,height:200});
  await page.goto(base+'#/tools/preview');await page.locator('[data-file-input]').setInputFiles({name:'no-text.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});
  await expect(page.locator('[data-reader-status]')).toContainText('no selectable text');await expect(page.locator('[data-reader-status]')).toContainText('OCR');
});
