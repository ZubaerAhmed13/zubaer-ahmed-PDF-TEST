import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
const base='/zubaer-ahmed-PDF-TEST/';
test('new image-to-PDF workflow previews source images and exports real PDF pages',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(base+'#/tools/images-to-pdf');
  const [first,second]=await Promise.all([
    readFile('tests/fixtures/ocr-corpus/eng-sans.png'),
    readFile('tests/fixtures/ocr-corpus/deu-sans.png')
  ]);
  await page.locator('[data-file-input]').setInputFiles([
    {name:'English sample.png',mimeType:'image/png',buffer:first},
    {name:'German sample.png',mimeType:'image/png',buffer:second}
  ]);
  await expect(page.locator('.df2-image-thumb')).toHaveCount(2);
  await expect(page.locator('[data-render-status]')).toContainText('Image 1 of 2');
  const canvas=page.locator('[data-page-canvas]');
  await expect.poll(async()=>canvas.evaluate(el=>(el as HTMLCanvasElement).width)).toBeGreaterThan(100);
  await page.getByRole('button',{name:/Preview image 2/}).click();
  await expect(page.locator('[data-render-status]')).toContainText('Image 2 of 2');
  await page.getByRole('button',{name:'Options',exact:true}).click();
  await page.locator('select[name=pageSize]').selectOption('letter');
  await page.locator('select[name=orientation]').selectOption('portrait');
  await page.locator('input[name=margin]').fill('50');
  await page.getByRole('button',{name:'Close options'}).click();
  await page.getByRole('button',{name:'Move German sample.png up'}).click();
  await expect(page.locator('.df2-file').first()).toContainText('German sample.png');
  await expect(page.locator('select[name=pageSize]')).toHaveValue('letter');
  await expect(page.locator('select[name=orientation]')).toHaveValue('portrait');
  await expect(page.locator('input[name=margin]')).toHaveValue('50');
  await page.locator('[data-run]').click();
  await expect(page.locator('.df2-result')).toBeVisible();
  const pending=page.waitForEvent('download');
  await page.locator('.df2-output').first().click();
  const download=await pending;
  const path=await download.path();if(!path)throw Error('Download unavailable');
  const output=await PDFDocument.load(await readFile(path));
  expect(output.getPageCount()).toBe(2);
  expect(output.getPages().every(p=>p.getWidth()===612&&p.getHeight()===792)).toBe(true);
});
