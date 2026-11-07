import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
const base='/zubaer-ahmed-PDF-TEST/';
async function sample(name:string, texts:string[]) {
  const doc=await PDFDocument.create();const font=await doc.embedFont(StandardFonts.Helvetica);
  texts.forEach((text,i)=>{
    const page=doc.addPage([510,680]);
    page.drawText(text,{x:52,y:590,font,size:17});
    page.drawText('Document page '+(i+1),{x:50,y:555,font,size:12});
  });
  return {name,mimeType:'application/pdf',buffer:Buffer.from(await doc.save())};
}
async function exported(page:import('@playwright/test').Page):Promise<{filename:string;data:string}> {
  const waiter=page.waitForEvent('download');
  await page.locator('.df2-output').first().click();
  const download=await waiter,path=await download.path();
  if(!path)throw Error('Downloaded file was not available');
  return {filename:download.suggestedFilename(),data:(await readFile(path)).toString('utf8')};
}
test('search and extract returns real selectable text and per-page search hits',async({page})=>{
  await page.goto(base+'#/tools/text-search');
  await page.locator('[data-file-input]').setInputFiles(await sample('report.pdf',['A unique Needle appears here','No matching keyword on this page']));
  await expect(page.locator('.df2-work')).toBeVisible();
  await page.locator('input[name=query]').fill('needle');
  await page.locator('[data-run]').click();
  await expect(page.locator('.df2-result')).toBeVisible();
  await expect(page.locator('.df2-review')).toContainText('1 matches across 1 pages');
  await expect(page.locator('.df2-review-row')).toHaveCount(1);
  await expect(page.locator('.df2-review-row').first()).toContainText('Page 1');
  const output=await exported(page);
  expect(output.filename).toBe('extracted-text.txt');
  expect(output.data).toContain('A unique Needle appears here');
  expect(output.data).toContain('--- Page 2 ---');
});
test('two-PDF comparison produces real differences, safe preview and downloadable report',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(base+'#/tools/compare');
  await page.locator('[data-file-input]').setInputFiles([
    await sample('before.pdf',['Statement total: 100','Same appendix']),
    await sample('after.pdf',['Statement total: 900','Same appendix'])
  ]);
  await expect(page.locator('.df2-file')).toHaveCount(2);
  await page.getByRole('button',{name:'Options'}).click();
  await page.getByRole('combobox',{name:'Comparison'}).selectOption('both');
  await page.locator('[data-run]').click();
  await expect(page.locator('.df2-result')).toBeVisible();
  await expect(page.locator('.df2-review')).toContainText(/changed or moved page matches/);
  await expect(page.locator('.df2-review-figure img').first()).toBeVisible();
  await expect(page.locator('.df2-output')).toHaveCount(2);
  const output=await exported(page);
  expect(output.filename).toBe('comparison-report.txt');
  expect(output.data).toContain('PDF comparison');
  expect(output.data).toContain('Document A: 2 pages');
  expect(output.data).toContain('Document B: 2 pages');
  expect(output.data).toMatch(/different|removed|added/i);
});
test('comparison enforces two-input contract before running',async({page})=>{
  await page.goto(base+'#/tools/compare');
  await page.locator('[data-file-input]').setInputFiles(await sample('one.pdf',['Only one input']));
  await expect(page.locator('.df2-work')).toBeVisible();
  await page.locator('[data-run]').click();
  await expect(page.locator('[data-run-status]')).toContainText('exactly two PDFs');
  await expect(page.locator('.df2-result')).toHaveCount(0);
});
