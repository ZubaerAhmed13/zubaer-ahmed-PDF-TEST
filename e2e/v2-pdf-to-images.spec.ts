import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

const url='/zubaer-ahmed-PDF-TEST/#/tools/pdf-to-images';
async function sample(count=2){
  const pdf=await PDFDocument.create();
  const font=await pdf.embedFont(StandardFonts.Helvetica);
  for(let n=0;n<count;n++){
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

test('selects individual pages or ranges and preserves their source numbers in the ZIP', async ({ page }) => {
  await page.goto(url);
  await page.locator('[data-file-input]').setInputFiles(await sample(4));
  await expect(page.locator('.df2-thumb[data-page]')).toHaveCount(4);
  const selection = page.getByLabel('Pages to export', { exact: true });
  await expect(selection).toBeVisible();
  const pageTwo = page.getByRole('button', { name: 'Select page 2', exact: true });
  await pageTwo.click();
  await expect(selection).toHaveValue('2');
  await pageTwo.click();
  await expect(selection).toHaveValue('2');
  await expect(page.locator('[data-run-status]')).toContainText('Keep at least one selected page');
  await selection.fill('2, 4');
  await expect(page.getByRole('button', { name: 'Select page 4', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Select page 3', exact: true }).click();
  await expect(selection).toHaveValue('2-4');
  await selection.fill('9');
  await page.locator('[data-run]').click();
  await expect(page.locator('[data-run-status]')).toContainText('Invalid page number: 9');
  await expect(page.locator('.df2-output')).toHaveCount(0);
  await selection.fill('4, 2, 2');
  const entries = await exportFiles(page);
  expect(entries.map(entry => entry.name)).toEqual(['page-002.png', 'page-004.png']);
  for (const [index, width] of [400, 600].entries()) {
    const png = Buffer.from(await entries[index]!.async('uint8array'));
    expect(png.readUInt32BE(16)).toBe(width);
  }
  await page.locator('[data-return-edit]').click();
  await expect(selection).toHaveValue('4, 2, 2');
  await expect(page.getByRole('button', { name: 'Select page 4', exact: true })).toHaveAttribute('aria-pressed', 'true');
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
