import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

const prefix='/zubaer-ahmed-PDF-TEST/';
async function pdf(name:string,width:number,pages=1) {
  const doc=await PDFDocument.create();
  for(let n=0;n<pages;n++)doc.addPage([width+n,500]);
  return {name,mimeType:'application/pdf',buffer:Buffer.from(await doc.save())};
}
test('entirely new homepage and tools are navigable without legacy styles',async({page})=>{
  await page.goto(prefix+'#/');
  await expect(page.getByRole('heading',{name:/Every document/})).toBeVisible();
  await expect(page.locator('.df2-toolgrid')).toBeVisible();
  await expect(page.locator('.app-shell,.workspace-page,.legacy-live-preview')).toHaveCount(0);
  await page.getByRole('searchbox',{name:'Search PDF tools'}).fill('rotate');
  await expect(page.locator('.df2-toolcard')).toHaveCount(1);
  await page.locator('[data-category="all"]').click();
  await page.getByRole('link',{name:'Rotate PDF'}).first().click();
  await expect(page.getByRole('heading',{name:'Rotate PDF'})).toBeVisible();
  await expect(page.locator('[data-file-input]')).toHaveCount(1);
});
test('new three-stage Merge PDF flow exports actual reordered page bytes',async({page})=>{
  await page.goto(prefix+'#/tools/merge');
  await page.locator('[data-file-input]').setInputFiles([await pdf('first.pdf',301),await pdf('second.pdf',488)]);
  await expect(page.locator('.df2-file')).toHaveCount(2);
  await expect(page.locator('[data-page-canvas]')).toBeVisible();
  await page.getByRole('button',{name:'Move second.pdf up'}).click();
  await expect(page.locator('.df2-file').first()).toContainText('second.pdf');
  await page.locator('[data-run]').click();
  await expect(page.locator('.df2-result')).toBeVisible();
  const pending=page.waitForEvent('download');
  await page.locator('.df2-output').first().click();
  const path=await (await pending).path();
  if(!path)throw new Error('Missing download');
  const result=await PDFDocument.load(await readFile(path));
  expect(result.getPages().map(p=>p.getWidth())).toEqual([488,301]);
  await page.getByRole('button',{name:'Start another file'}).click();
  await expect(page.locator('.df2-dropbox')).toBeVisible();
});
test('new phone workspace provides zoom, settings and valid Extract Pages output',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(prefix+'#/tools/extract-pages');
  await page.locator('[data-file-input]').setInputFiles(await pdf('four-pages.pdf',300,4));
  await expect(page.locator('.df2-workflow')).toBeVisible();
  await expect(page.locator('[data-page-label]')).toContainText('Page 1 / 4');
  await page.getByRole('button',{name:'Options'}).click();
  await expect(page.locator('[data-options-pane]')).toHaveClass(/opened/);
  await page.locator('input[name="pages"]').fill('2-3');
  await page.locator('[data-run]').click();
  await expect(page.locator('.df2-result')).toBeVisible();
  const pending=page.waitForEvent('download');
  await page.locator('.df2-output').click();
  const path=await (await pending).path();
  if(!path)throw new Error('Missing download');
  const output=await PDFDocument.load(await readFile(path));
  expect(output.getPages().map(p=>p.getWidth())).toEqual([301,302]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});
test('OCR opens the document-first workflow with an explicit local processing notice',async({page})=>{
  await page.goto(prefix+'#/');
  await page.locator('[data-card-tool="ocr"]').click();
  await expect(page.getByRole('heading',{name:'OCR scanned PDF'})).toBeVisible();
  await page.locator('[data-file-input]').setInputFiles(await pdf('scan.pdf',500));
  await expect(page.getByLabel('Recognition language')).toBeVisible();
  await expect(page.getByText(/No document upload/)).toBeVisible();
  await expect(page.locator('[data-run]')).toBeEnabled();
});
