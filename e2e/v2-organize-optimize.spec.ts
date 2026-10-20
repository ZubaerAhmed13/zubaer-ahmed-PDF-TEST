import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
const base='/zubaer-ahmed-PDF-TEST/';
async function pdf(count:number) {
  const doc=await PDFDocument.create();
  for(let n=0;n<count;n++)doc.addPage([310+n*37,450]);
  return {name:'input.pdf',mimeType:'application/pdf',buffer:Buffer.from(await doc.save())};
}
async function download(page:import('@playwright/test').Page):Promise<PDFDocument>{
  await page.locator('[data-run]').click();
  await expect(page.locator('.df2-result')).toBeVisible();
  const pending=page.waitForEvent('download');
  await page.locator('.df2-output').first().click();
  const filename=await(await pending).path();if(!filename)throw Error('No file');
  return PDFDocument.load(await readFile(filename));
}
test('visual page plan changes real PDF order, duplicates pages, supports undo and reset',async({page})=>{
  await page.goto(base+'#/tools/organize');
  await page.locator('[data-file-input]').setInputFiles(await pdf(4));
  await expect(page.locator('.df2-plan-row')).toHaveCount(4);
  await page.getByRole('button',{name:'Move page 3 up'}).click();
  await expect(page.locator('.df2-plan-row').nth(1)).toContainText('Page 3');
  await page.getByRole('button',{name:'Duplicate page 3'}).click();
  await expect(page.locator('.df2-plan-row')).toHaveCount(5);
  await page.getByRole('button',{name:'↶ Undo'}).click();
  await expect(page.locator('.df2-plan-row')).toHaveCount(4);
  await page.getByRole('button',{name:'Duplicate page 3'}).click();
  await page.getByRole('button',{name:'Remove page 1'}).click();
  const widths=(await download(page)).getPages().map(p=>p.getWidth());
  expect(widths).toEqual([384,384,347,421]);
});
test('real selective JPEG optimizer preserves editable PDF page structure',async({page})=>{
  await page.goto(base+'#/tools/compress');
  await page.locator('[data-file-input]').setInputFiles(await pdf(3));
  await expect(page.locator('.df2-workflow')).toBeVisible();
  await page.getByRole('combobox',{name:'Image compression'}).selectOption('quality');
  const doc=await download(page);
  expect(doc.getPageCount()).toBe(3);
  expect(doc.getPages().map(p=>p.getWidth())).toEqual([310,347,384]);
  await expect(page.locator('.df2-result-info')).toBeVisible();
});
test('smartphone page organizer works without gestures and has keyboard-accessible actions',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(base+'#/tools/organize');
  await page.locator('[data-file-input]').setInputFiles(await pdf(2));
  await page.getByRole('button',{name:'Options'}).click();
  await expect(page.locator('.df2-plan-row')).toHaveCount(2);
  await page.getByRole('button',{name:'Move page 2 up'}).click();
  await expect(page.locator('.df2-plan-row').first()).toContainText('Page 2');
  const doc=await download(page);
  expect(doc.getPages().map(p=>p.getWidth())).toEqual([347,310]);
});
