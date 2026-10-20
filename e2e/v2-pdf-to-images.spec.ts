import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

const url='/zubaer-ahmed-PDF-TEST/#/tools/pdf-to-images';
async function sample(){
  const pdf=await PDFDocument.create();
  const font=await pdf.embedFont(StandardFonts.Helvetica);
  for(let n=0;n<2;n++){
    const page=pdf.addPage([300+n*100,400+n*150]);
    page.drawText('Page '+(n+1),{x:25,y:page.getHeight()-45,font,size:18});
  }
  return {name:'test-pages.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())};
}
async function exportFiles(page:import('@playwright/test').Page){
  await page.locator('[data-run]').click();
  await expect(page.locator('.df2-result')).toBeVisible();
  const wait=page.waitForEvent('download');
  await page.locator('.df2-output').first().click();
  const path=await(await wait).path();
  if(!path)throw Error('Missing ZIP');
  const zip=await JSZip.loadAsync(await readFile(path));
  return Object.values(zip.files).filter(f=>!f.dir).sort((a,b)=>a.name.localeCompare(b.name));
}
test('PDF to Images produces actual per-page PNG images, not a mock ZIP',async({page})=>{
  await page.goto(url);
  await page.locator('[data-file-input]').setInputFiles(await sample());
  await expect(page.locator('.df2-thumb[data-page]')).toHaveCount(2);
  const files=await exportFiles(page);
  expect(files.map(x=>x.name)).toEqual(['page-001.png','page-002.png']);
  const first=Buffer.from(await files[0]!.async('uint8array'));
  const second=Buffer.from(await files[1]!.async('uint8array'));
  expect(first.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(second.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(second.readUInt32BE(16)).toBeGreaterThan(first.readUInt32BE(16));
});
test('phone PDF-to-JPEG workflow exports two real JPEG pages',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(url);
  await page.locator('[data-file-input]').setInputFiles(await sample());
  await page.getByRole('button',{name:'Options'}).click();
  await page.locator('select[name=format]').selectOption('jpeg');
  await page.locator('select[name=scale]').selectOption('1');
  const files=await exportFiles(page);
  expect(files.map(f=>f.name)).toEqual(['page-001.jpg','page-002.jpg']);
  for(const entry of files){
    const bytes=Buffer.from(await entry.async('uint8array'));
    expect(bytes.subarray(0,3).toString('hex')).toBe('ffd8ff');
    expect(bytes.length).toBeGreaterThan(300);
  }
});
