import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
const prefix='/zubaer-ahmed-PDF-TEST/';
const password='DocFlow-Test-2026!';
async function source(){
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);
  const page=doc.addPage([421,612]);page.drawText('Preserve this content',{x:40,y:560,font,size:16});
  return {name:'sensitive.pdf',mimeType:'application/pdf',buffer:Buffer.from(await doc.save())};
}
async function resultBytes(page:import('@playwright/test').Page):Promise<Buffer>{
  await expect(page.locator('.df2-result')).toBeVisible({timeout:30000});
  const pending=page.waitForEvent('download');
  await page.locator('.df2-output').first().click();
  const file=await(await pending).path();
  if(!file)throw Error('Missing downloaded PDF');
  return readFile(file);
}
test('AES-256 PDF protection validates passwords and round-trips through the real qpdf unlock worker',async({page})=>{
  await page.goto(prefix+'#/tools/protect-pdf');
  await page.locator('[data-file-input]').setInputFiles(await source());
  await page.locator('input[name=securityPassword]').fill(password);
  await page.locator('input[name=confirmPassword]').fill('Wrong-Password');
  await page.locator('[data-run]').click();
  await expect(page.locator('[data-run-status]')).toContainText('does not match');
  await expect(page.locator('.df2-result')).toHaveCount(0);
  await page.locator('input[name=confirmPassword]').fill(password);
  await page.locator('[data-run]').click();
  const protectedBytes=await resultBytes(page);
  expect(protectedBytes.subarray(0,5).toString('latin1')).toBe('%PDF-');
  await expect(PDFDocument.load(protectedBytes)).rejects.toThrow();
  await page.getByRole('button',{name:'Return to editing'}).click();
  await expect(page.locator('input[name=securityPassword]')).toHaveValue('');
  await expect(page.locator('input[name=confirmPassword]')).toHaveValue('');
  page.once('dialog',dialog=>dialog.accept());
  await page.goto(prefix+'#/tools/unlock-pdf');
  await page.locator('[data-file-input]').setInputFiles({
    name:'locked.pdf',mimeType:'application/pdf',buffer:protectedBytes
  });
  await expect(page.locator('.df2-work')).toBeVisible();
  await page.locator('input[name=securityPassword]').fill(password);
  await page.locator('[data-run]').click();
  const unlocked=await PDFDocument.load(await resultBytes(page));
  expect(unlocked.getPageCount()).toBe(1);
  expect(unlocked.getPage(0).getWidth()).toBe(421);
});
test('qpdf repair rewrites valid PDF structure without losing pages',async({page})=>{
  await page.goto(prefix+'#/tools/repair-pdf');
  await page.locator('[data-file-input]').setInputFiles(await source());
  await expect(page.locator('.df2-work')).toBeVisible();
  await page.locator('[data-run]').click();
  const output=await PDFDocument.load(await resultBytes(page));
  expect(output.getPageCount()).toBe(1);
  expect(output.getPage(0).getWidth()).toBe(421);
  expect(output.getPage(0).getHeight()).toBe(612);
});
