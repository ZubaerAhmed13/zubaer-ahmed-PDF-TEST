import {test,expect} from '@playwright/test';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {readFile} from 'node:fs/promises';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
test.use({serviceWorkers:'block'});

const prefix='/zubaer-ahmed-PDF-TEST/';
async function textPdf(){const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);for(const value of ['Already searchable first page','Second source page preserved'])pdf.addPage([500,300]).drawText(value,{font,size:20,x:25,y:220});return Buffer.from(await pdf.save());}
test('OCR preserves unprocessed pages, reviews actual output and restores options without loading a model for searchable pages',async({page})=>{
  const external:string[]=[],models:string[]=[];
  await page.goto(prefix+'#/tools/ocr');const origin=new URL(page.url()).origin;
  page.on('request',r=>{if(new URL(r.url()).origin!==origin)external.push(r.url());if(r.url().includes('traineddata'))models.push(r.url());});
  await page.locator('[data-file-input]').setInputFiles({name:'searchable.pdf',mimeType:'application/pdf',buffer:await textPdf()});
  await page.getByLabel('Recognition language').selectOption('eng+deu');await page.getByLabel('Maximum pages per run').fill('1');
  await page.locator('[data-run]').click();await expect(page.locator('.df2-result')).toBeVisible();
  await expect(page.locator('.df2-review-warning')).toContainText('Unprocessed pages preserved unchanged: 2');
  await expect(page.getByRole('heading',{name:'Review searchable OCR PDF'})).toBeVisible();
  const pending=page.waitForEvent('download');await page.locator('.df2-output').filter({hasText:'searchable-ocr.pdf'}).click();const path=await(await pending).path();if(!path)throw Error('Missing OCR output');
  const actual=await PDFDocument.load(await readFile(path));expect(actual.getPageCount()).toBe(2);
  await page.getByRole('button',{name:'Return to editing'}).click();await expect(page.getByLabel('Recognition language')).toHaveValue('eng+deu');await expect(page.getByLabel('Maximum pages per run')).toHaveValue('1');
  expect(external).toEqual([]);expect(models).toEqual([]);
});
test('OCR recognises a real scan and exposes a searchable PDF through the new result review',async({page})=>{
  test.setTimeout(120000);await page.goto(prefix+'#/tools/ocr');
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1000;c.height=320;const x=c.getContext('2d')!;x.fillStyle='white';x.fillRect(0,0,1000,320);x.fillStyle='black';x.font='bold 92px Arial';x.fillText('DOCFLOW OCR TEST',48,180);return c.toDataURL('image/png').split(',')[1]!;});
  const pdf=await PDFDocument.create(),picture=await pdf.embedPng(Buffer.from(png,'base64'));pdf.addPage([500,160]).drawImage(picture,{x:0,y:0,width:500,height:160});
  const external:string[]=[],origin=new URL(page.url()).origin;page.on('request',r=>{if(new URL(r.url()).origin!==origin)external.push(r.url());});
  await page.locator('[data-file-input]').setInputFiles({name:'scan.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});
  await page.getByLabel('Maximum pages per run').fill('1');await page.locator('[data-run]').click();await expect(page.locator('.df2-result')).toBeVisible({timeout:105000});
  const pending=page.waitForEvent('download');await page.locator('.df2-output').filter({hasText:'searchable-ocr.pdf'}).click();const path=await(await pending).path();if(!path)throw Error('Missing searchable PDF');
  const actual=await readFile(path),task=getDocument({data:new Uint8Array(actual)}),viewer=await task.promise;
  try{expect(viewer.numPages).toBe(1);const first=await viewer.getPage(1);const text=await first.getTextContent();expect(text.items.map(item=>'str' in item?item.str:'').join(' ').toUpperCase()).toMatch(/DOCFLOW.*OCR/);}finally{await viewer.destroy();}
  expect(external).toEqual([]);
});
test('OCR correction preview rejects invalid angles and leaves the source document available',async({page})=>{
  await page.goto(prefix+'#/tools/ocr');await page.locator('[data-file-input]').setInputFiles({name:'source.pdf',mimeType:'application/pdf',buffer:await textPdf()});
  await page.getByText('Recognition preview and corrections',{exact:true}).click();await page.getByLabel('Deskew angle').fill('16');await page.locator('[data-ocr-preview]').click();
  await expect(page.locator('[data-ocr-preview-status]')).toContainText('between −15° and 15°');
  await page.getByLabel('Deskew angle').fill('2');await page.locator('[data-ocr-preview]').click();await expect(page.locator('[data-ocr-preview-pair] canvas')).toHaveCount(2);
  await expect(page.locator('.df2-file')).toContainText('source.pdf');await expect(page.locator('[data-run]')).toBeEnabled();
});
test('changing OCR corrections invalidates an in-flight preview for previous settings',async({page})=>{
  await page.route('**/assets/localOcr-*.js',route=>route.fulfill({contentType:'text/javascript',body:'export function ocrPreview(){return new Promise(resolve=>{window.releaseOcrTestPreview=()=>resolve({original:document.createElement("canvas"),corrected:document.createElement("canvas")});});}'}));
  await page.goto(prefix+'#/tools/ocr');await page.locator('[data-file-input]').setInputFiles({name:'source.pdf',mimeType:'application/pdf',buffer:await textPdf()});
  await page.getByText('Recognition preview and corrections',{exact:true}).click();await page.locator('[data-ocr-preview]').click();
  await page.waitForFunction(()=>typeof(window as Window&{releaseOcrTestPreview?:()=>void}).releaseOcrTestPreview==='function');
  await page.getByLabel('Deskew angle').fill('3');await expect(page.locator('[data-ocr-preview-status]')).toContainText('Settings changed');
  await page.evaluate(()=>(window as Window&{releaseOcrTestPreview:()=>void}).releaseOcrTestPreview());
  await expect(page.locator('[data-ocr-preview-pair] canvas')).toHaveCount(0);await expect(page.locator('[data-ocr-preview-status]')).toContainText('Settings changed');
});
