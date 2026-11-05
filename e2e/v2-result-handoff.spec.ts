import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

const base = '/zubaer-ahmed-PDF-TEST/';

test('opens the selected split PDF in a second tool without uploading again', async ({ page, browserName }, info) => {
  const source = await PDFDocument.create();
  source.addPage([315, 480]);
  source.addPage([477, 590]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '#/tools/split');
  await page.locator('[data-file-input]').setInputFiles({
    name: 'two-sections.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await source.save()),
  });
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.getByRole('combobox', { name: 'Split method' }).selectOption('individual');
  await expect(page.getByRole('combobox', { name: 'Output format' })).toHaveValue('zip');
  await page.locator('[data-run]').click();
  await expect(page.locator('.df2-output')).toHaveAttribute('download', 'split-pdf.zip');
  await expect(page.getByText('Use PDF in another tool', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Return to editing' }).click();
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.getByRole('combobox', { name: 'Output format' }).selectOption('pdfs');
  await page.locator('[data-run]').click();
  await expect(page.locator('.df2-output')).toHaveCount(2);

  await page.getByText('Use PDF in another tool', { exact: true }).click();
  await page.getByRole('combobox', { name: 'PDF result' }).selectOption('1');
  const nextTool=page.getByRole('combobox', { name: 'Next tool' });
  await expect(nextTool.locator('option').filter({ hasText: 'Images to PDF' })).toHaveCount(0);
  await nextTool.selectOption('rotate');
  if(browserName==='chromium'){
    await info.attach('pdf-handoff-phone',{body:await page.locator('[data-result-handoff]').screenshot(),contentType:'image/png'});
  }
  await page.getByRole('button', { name: 'Open selected PDF' }).click();
  await expect(page).toHaveURL(/#\/tools\/rotate\/work$/);
  await expect(page.locator('.df2-file')).toHaveCount(1);
  await expect(page.locator('.df2-file')).toContainText('split-02.pdf');
  await expect(page.locator('[data-page-label]')).toContainText('Page 1 / 1');

  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.getByRole('combobox', { name: 'Rotation', exact: true }).selectOption('270');
  await page.locator('[data-run]').click();

  const downloading = page.waitForEvent('download');
  await page.locator('.df2-output').click();
  const path = await (await downloading).path();
  if (!path) throw Error('Missing rotated PDF');
  const result = await PDFDocument.load(await readFile(path));
  expect(result.getPageCount()).toBe(1);
  expect(result.getPage(0).getWidth()).toBe(477);
  expect(result.getPage(0).getRotation().angle).toBe(270);
});

test('keeps the output downloadable after a rejected or cancelled handoff', async ({ page }) => {
  await page.addInitScript(()=>{
    const Native=window.Worker;
    window.Worker=class extends Native{
      postMessage(message:{operation?:string},transfer:Transferable[]){
        const state=window as unknown as {holdHandoff?:boolean;handoffHeld?:boolean};
        if(state.holdHandoff&&message.operation==='document-inspect'){state.handoffHeld=true;return;}
        super.postMessage(message,transfer);
      }
    } as typeof Worker;
  });
  const source = await PDFDocument.create();
  for (let index = 0; index < 16; index++) source.addPage([315, 480]);

  await page.goto(base + '#/tools/rotate');
  await page.locator('[data-file-input]').setInputFiles({
    name: 'sixteen-pages.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await source.save()),
  });
  await page.locator('[data-run]').click();
  await page.getByText('Use PDF in another tool', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Next tool' }).selectOption('redact-secure');
  await page.getByRole('button', { name: 'Open selected PDF' }).click();
  await expect(page.locator('[data-handoff-status]')).toContainText('at most 15 pages');
  await expect(page).toHaveURL(/#\/tools\/rotate\/result$/);
  await expect(page.getByRole('button', { name: 'Open selected PDF' })).toBeEnabled();

  await page.getByRole('combobox', { name: 'Next tool' }).selectOption('extract-pages');
  await page.evaluate(()=>{(window as unknown as {holdHandoff:boolean}).holdHandoff=true;});
  await page.getByRole('button', { name: 'Open selected PDF' }).click();
  await page.waitForFunction(()=>(window as unknown as {handoffHeld?:boolean}).handoffHeld===true);
  let confirmText='';
  page.once('dialog',async dialog=>{confirmText=dialog.message();await dialog.dismiss();});
  await page.locator('.df2-result .df2-crumbs').getByRole('link', { name: 'All tools' }).click();
  await expect(page).toHaveURL(/#\/tools\/rotate\/result$/);
  await expect(page.getByRole('button', { name: 'Open selected PDF' })).toBeEnabled();
  expect(confirmText).toContain('Leave this document?');

  const downloading = page.waitForEvent('download');
  await page.locator('.df2-output').click();
  const path = await (await downloading).path();
  if (!path) throw Error('Missing retained PDF');
  expect((await PDFDocument.load(await readFile(path))).getPageCount()).toBe(16);
});
