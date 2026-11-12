import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

const route='/zubaer-ahmed-PDF-TEST/#/tools/rotate';

test('rapid page changes render the last selected page at its own size',async({page})=>{
  const source=await PDFDocument.create();
  for(let index=0;index<7;index++)source.addPage([320+index*48,510+index*31]);
  await page.goto(route);
  await page.locator('[data-file-input]').setInputFiles({
    name:'different-page-geometries.pdf',
    mimeType:'application/pdf',
    buffer:Buffer.from(await source.save())
  });
  await expect(page.locator('[data-render-status]')).toHaveText('Page 1 of 7');
  await expect(page.locator('[data-page-label]')).toHaveText('Page 1 / 7');

  // Trigger overlapping getPage/render calls without waiting for earlier
  // click handlers. A stale request must not overwrite page 7's viewport.
  await page.evaluate(()=>{
    const forward=document.querySelector<HTMLButtonElement>('[data-page-next]');
    if(!forward)throw Error('Next-page control missing');
    for(let index=0;index<6;index++)forward.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  });

  await expect(page.locator('[data-page-label]')).toHaveText('Page 7 / 7');
  await expect(page.locator('[data-render-status]')).toHaveText('Page 7 of 7');
  await expect.poll(()=>page.locator('[data-page-canvas]').evaluate((element)=>{
    const canvas=element as HTMLCanvasElement;
    const stage=document.querySelector<HTMLElement>('.df2-page-stage')!;
    return Math.abs(parseFloat(canvas.style.width)-(Math.max(100,stage.clientWidth-32)));
  })).toBeLessThanOrEqual(2);
  const first=await page.locator('[data-page-canvas]').evaluate(el=>({
    width:parseFloat((el as HTMLCanvasElement).style.width),
    height:parseFloat((el as HTMLCanvasElement).style.height)
  }));
  expect(first.height/first.width).toBeCloseTo((510+6*31)/(320+6*48),1);
  await page.waitForTimeout(300);
  await expect(page.locator('[data-render-status]')).toHaveText('Page 7 of 7');
  await expect(page.locator('[data-page-label]')).toHaveText('Page 7 / 7');

  // Another fast burst in the opposite direction must also settle on
  // the latest page, not on an old overlapping render completion.
  await page.evaluate(()=>{
    const backward=document.querySelector<HTMLButtonElement>('[data-page-prev]');
    if(!backward)throw Error('Previous-page control missing');
    for(let index=0;index<5;index++)backward.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  });
  await expect(page.locator('[data-page-label]')).toHaveText('Page 2 / 7');
  await expect(page.locator('[data-render-status]')).toHaveText('Page 2 of 7');
  await expect.poll(()=>page.locator('[data-page-canvas]').evaluate((element)=>{
    const canvas=element as HTMLCanvasElement;
    const stage=document.querySelector<HTMLElement>('.df2-page-stage')!;
    return Math.abs(parseFloat(canvas.style.width)-(Math.max(100,stage.clientWidth-32)));
  })).toBeLessThanOrEqual(2);
});
