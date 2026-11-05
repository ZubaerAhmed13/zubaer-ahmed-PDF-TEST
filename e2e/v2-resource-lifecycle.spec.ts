import {test,expect,type Page} from '@playwright/test';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {readFile} from 'node:fs/promises';
const base='/zubaer-ahmed-PDF-TEST/';
async function fixture(pages:number){const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);for(let n=0;n<pages;n++)pdf.addPage([400+n%3,580]).drawText('Document page '+(n+1),{font,size:16,x:25,y:520});return Buffer.from(await pdf.save());}

test('240-page workspace reaches late pages and exports only the requested rotation',async({page})=>{
  test.setTimeout(90000);await page.goto(base+'#/tools/rotate');await page.locator('[data-file-input]').setInputFiles({name:'240-pages.pdf',mimeType:'application/pdf',buffer:await fixture(240)});
  await expect(page.locator('.df2-thumb[data-page]')).toHaveCount(240);await page.getByRole('button',{name:'Select page 221',exact:true}).click();await expect(page.locator('[data-page-label]')).toContainText('Page 221 / 240');
  await page.getByRole('combobox',{name:'Rotate',exact:true}).selectOption('selected');await page.getByRole('combobox',{name:'Rotation',exact:true}).selectOption('270');await expect(page.getByLabel('Selected pages (when needed)')).toHaveValue('221');
  await page.locator('[data-run]').click();await expect(page.locator('.df2-result')).toBeVisible();const pending=page.waitForEvent('download');await page.locator('.df2-output').first().click();const path=await(await pending).path();if(!path)throw Error('Missing long-document output');
  const pdf=await PDFDocument.load(await readFile(path));expect(pdf.getPageCount()).toBe(240);expect(pdf.getPages().filter(p=>p.getRotation().angle!==0)).toHaveLength(1);expect(pdf.getPage(220).getRotation().angle).toBe(270);expect(pdf.getPage(239).getWidth()).toBe(402);
});
async function cycle(page:Page,source:Buffer,index:number){
  await page.goto(base+'#/tools/preview');await page.locator('[data-file-input]').setInputFiles({name:'preview-'+index+'.pdf',mimeType:'application/pdf',buffer:source});await expect(page.locator('[data-page-label]')).toContainText('Page 1 / 16');
  await page.getByRole('button',{name:'Next page',exact:true}).click();await expect(page.locator('[data-page-label]')).toContainText('Page 2 / 16');await page.getByRole('button',{name:'Next page',exact:true}).click();await expect(page.locator('[data-page-label]')).toContainText('Page 3 / 16');
  await page.locator('[data-run]').click();await expect(page.locator('.df2-result')).toBeVisible();await page.getByRole('button',{name:'Start another file'}).click();await expect(page.locator('.df2-dropbox')).toBeVisible();await page.locator('.df2-brand').click();await expect(page.locator('[data-page-canvas]')).toHaveCount(0);
}
test('Chromium heap settles after repeated v2 preview, original-output and disposal cycles',async({page,context,browserName},info)=>{
  test.skip(browserName!=='chromium','Forced-GC heap measurement uses Chromium DevTools Protocol; other engines are not measured by this check.');test.setTimeout(120000);
  const source=await fixture(16),session=await context.newCDPSession(page);await session.send('HeapProfiler.enable');await cycle(page,source,-1);await session.send('HeapProfiler.collectGarbage');const baseline=await session.send('Runtime.getHeapUsage') as {usedSize:number};const samples:number[]=[];
  for(let n=0;n<8;n++){await cycle(page,source,n);await session.send('HeapProfiler.collectGarbage');samples.push((await session.send('Runtime.getHeapUsage') as {usedSize:number}).usedSize);}
  const growth=samples.at(-1)!-baseline.usedSize,tail=samples.slice(-3),spread=Math.max(...tail)-Math.min(...tail);
  await info.attach('v2-heap-samples',{body:JSON.stringify({scope:'Chromium JS heap after forced GC, not total browser/native/GPU memory',baseline:baseline.usedSize,samples,growth,tailSpread:spread}),contentType:'application/json'});
  expect(growth).toBeLessThanOrEqual(Math.max(12*1024*1024,baseline.usedSize*.45));expect(spread).toBeLessThanOrEqual(8*1024*1024);await session.send('HeapProfiler.disable');
});
