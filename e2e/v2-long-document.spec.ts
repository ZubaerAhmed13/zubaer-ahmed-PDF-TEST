import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

test('large PDFs keep all pages addressable with lazy thumbnails and real output',async({page})=>{
  const input=await PDFDocument.create();
  for(let n=0;n<34;n++)input.addPage([300+n,480]);
  await page.goto('/zubaer-ahmed-PDF-TEST/#/tools/rotate');
  await page.locator('[data-file-input]').setInputFiles({
    name:'thirty-four-pages.pdf',mimeType:'application/pdf',buffer:Buffer.from(await input.save())
  });
  await expect(page.locator('.df2-thumb[data-page]')).toHaveCount(34);
  await page.getByRole('button',{name:'Select page 31'}).click();
  await expect(page.locator('[data-page-label]')).toContainText('Page 31 / 34');
  await page.locator('select[name="target"]').selectOption('selected');
  await expect(page.locator('input[name="pages"]')).toHaveValue('31');
  await page.locator('[data-run]').click();
  await expect(page.locator('.df2-result')).toBeVisible();
  const pending=page.waitForEvent('download');
  await page.locator('.df2-output').first().click();
  const file=await (await pending).path();
  if(!file)throw Error('Missing exported PDF');
  const output=await PDFDocument.load(await readFile(file));
  expect(output.getPageCount()).toBe(34);
  expect(output.getPage(29).getRotation().angle).toBe(0);
  expect(output.getPage(30).getRotation().angle).toBe(90);
  expect(output.getPage(31).getRotation().angle).toBe(0);
});
