import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PDFDocument, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { riskyCorpus } from '../tests/fixtures/r5Corpus';
import { pdfPixels } from './helpers/pdfPixels';

async function open(page:Page,id:string,search:string) {
  await page.goto('/zubaer-ahmed-PDF-TEST/'); await page.getByLabel('Search tools').fill(search);
  await page.locator(`#tool-grid [data-open-tool="${id}"]`).click();
  return page.getByRole('dialog',{name:'Workspace'});
}
test('local inspection surfaces signature, active-content and page-copy consequences before export',async({page})=>{
  const requests:string[]=[]; page.on('request',request=>{if(!request.url().startsWith('data:')&&!request.url().startsWith('blob:'))requests.push(request.url());});
  const dialog=await open(page,'extract-pages','extract pages');
  await dialog.locator('#workspace-file').setInputFiles({name:'signed-active.pdf',mimeType:'application/pdf',buffer:Buffer.from(await riskyCorpus())});
  const panel=dialog.locator('[data-document-safety]');
  await expect(panel).toContainText('Document bookmarks, page labels, editable forms, attachments');
  await expect(panel).toContainText('Signature/certification structures detected');
  await expect(panel).toContainText('JavaScript');
  await expect(panel).toContainText('1 non-HTTPS or unsafe link');
  await panel.getByText('Local document inspection',{exact:true}).click();
  await expect(panel).toContainText('2 pages');
  expect((await new AxeBuilder({page}).include('[data-document-safety]').analyze()).violations).toEqual([]);
  const origin=new URL(page.url()).origin;
  expect(requests.filter(url=>new URL(url).origin!==origin)).toEqual([]);
});
test('redaction reviews individual areas and previews exact export bytes at the chosen resolution',async({page})=>{
  const dialog=await open(page,'redact-secure','permanent redaction');
  await dialog.locator('#pro-pdf').setInputFiles({name:'review.pdf',mimeType:'application/pdf',buffer:Buffer.from(await riskyCorpus())});
  await expect(dialog.locator('#pro-stage')).toHaveText('Ready to mark areas');
  await dialog.locator('#pro-dpi').selectOption('72');
  await dialog.getByRole('button',{name:'Add area using coordinates'}).click();
  await dialog.getByRole('button',{name:'Next page'}).click();
  await expect(dialog.locator('#pro-page-status')).toHaveText('Page 2 of 2');
  await dialog.getByRole('button',{name:'Add area using coordinates'}).click();
  await dialog.getByRole('button',{name:'Remove area 2',exact:true}).click();
  await dialog.getByRole('button',{name:/Area 1 · page 1/}).click();
  await expect(dialog.locator('#pro-page-status')).toHaveText('Page 1 of 2');
  await dialog.locator('#pro-confirm').check();
  await dialog.getByRole('button',{name:'Build export size preview'}).click();
  await expect(dialog.locator('#pro-size-result')).toContainText('Export preview ready',{timeout:90000});
  const sizeText=await dialog.locator('#pro-size-result').innerText();
  const size=Number(sizeText.match(/ready: ([\d,]+) bytes/)![1]!.replace(/,/g,''));
  await expect(dialog.locator('#pro-results a.download')).toHaveCount(0);
  const download=page.waitForEvent('download');
  await dialog.getByRole('button',{name:'Apply permanent redactions'}).click();
  await dialog.locator('#pro-results a.download').click();
  const location=await (await download).path(); if(!location)throw Error('No download');
  const bytes=await readFile(location);
  expect(bytes.length).toBe(size);
  const pdf=await PDFDocument.load(bytes);
  for(const key of ['Names','AcroForm','StructTreeRoot','Outlines','PageLabels','Perms','OpenAction'])expect(pdf.catalog.has(PDFName.of(key)),key).toBe(false);
  const pixels=await pdfPixels(bytes,1);
  const offset=(Math.floor(pixels.height*.15)*pixels.width+Math.floor(pixels.width*.2))*4;
  expect([...pixels.data.slice(offset,offset+3)]).toEqual([0,0,0]);
  await dialog.locator('#pro-dpi').selectOption('150');
  await expect(dialog.locator('#pro-size-result')).toBeEmpty();
  await expect(dialog.locator('#pro-results a.download')).toHaveCount(0);
});
test('repeated reader open/close releases worker, URL and canvas ownership within declared bounds',async({page},testInfo)=>{
  await page.addInitScript(()=>{
    const NativeWorker=window.Worker,active=new Set<Worker>(),urls=new Set<string>();
    window.Worker=class extends NativeWorker {constructor(url:string|URL,options?:WorkerOptions){super(url,options);active.add(this);}terminate(){active.delete(this);return super.terminate();}};
    const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=value=>{const url=create(value);urls.add(url);return url;}; URL.revokeObjectURL=url=>{urls.delete(url);revoke(url);};
    Object.assign(window,{r5Resources:()=>({workers:active.size,urls:urls.size,canvasPixels:[...document.querySelectorAll('canvas')].reduce((sum,c)=>sum+c.width*c.height,0)})});
  });
  const pdf=await PDFDocument.create();for(let i=0;i<40;i++)pdf.addPage([612,792]);const buffer=Buffer.from(await pdf.save());
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  const samples:unknown[]=[];
  for(let i=0;i<5;i++){
    await page.getByLabel('Search tools').fill('view pdf'); await page.locator('#tool-grid [data-open-tool="preview"]').click();
    const dialog=page.getByRole('dialog',{name:'Workspace'});
    await dialog.locator('#workspace-file').setInputFiles({name:'lifecycle.pdf',mimeType:'application/pdf',buffer});
    await dialog.getByRole('button',{name:'Run View PDF'}).click(); await expect(dialog.locator('#viewer-status')).toHaveText('Page 1 of 40');
    expect(await dialog.locator('canvas').evaluateAll(cs=>cs.reduce((sum,c)=>sum+(c as HTMLCanvasElement).width*(c as HTMLCanvasElement).height,0))).toBeLessThan(9_000_000);
    await dialog.getByRole('button',{name:'Close workspace',exact:true}).click();
    await expect(dialog).toBeHidden();
    await expect.poll(()=>page.evaluate(()=> (window as unknown as {r5Resources:()=>{workers:number}}).r5Resources().workers)).toBe(0);
    const sample=await page.evaluate(()=> (window as unknown as {r5Resources:()=>{workers:number;urls:number;canvasPixels:number}}).r5Resources());
    expect(sample.urls).toBeLessThanOrEqual(1); expect(sample.canvasPixels).toBe(0);samples.push(sample);
  }
  await testInfo.attach('R5 owned resource lifecycle',{body:JSON.stringify({fixture:'40 blank letter pages, five cycles',tolerance:'0 workers, 0 attached canvas pixels, <=1 live URL after close',samples}),contentType:'application/json'});
});
