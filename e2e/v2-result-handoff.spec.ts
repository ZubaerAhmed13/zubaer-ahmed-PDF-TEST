import { expect, test, type Locator, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFile } from 'node:fs/promises';

const base = '/zubaer-ahmed-PDF-TEST/';

async function downloadBytes(page: Page, link: Locator): Promise<Buffer> {
  const pending = page.waitForEvent('download');
  await link.click();
  const path = await (await pending).path();
  if (!path) throw Error('Missing PDF download');
  return readFile(path);
}

test('one import survives organize, annotate, page numbering and exact revision navigation', async ({ page }) => {
  const source = await PDFDocument.create();
  source.addPage([360, 500]).drawText('First source page', { x: 45, y: 410 });
  source.addPage([420, 560]).drawText('Second source page', { x: 45, y: 450 });
  const writes: string[] = [];
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
  await page.goto(base + '#/tools/organize');
  await page.locator('[data-file-input]').setInputFiles({ name: 'source.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await source.save()) });
  await page.getByRole('button', { name: 'Move page 2 up', exact: true }).click();
  const result = page.locator('.df2-output');
  const run = page.locator('[data-run]');
  const handoff = async (tool: string) => {
    await page.getByText('Use PDF in another tool', { exact: true }).click();
    await page.getByLabel('Next tool').selectOption(tool);
    await page.getByRole('button', { name: 'Open selected PDF' }).click();
    await expect(page.locator('[data-render-status]')).toHaveText('Page 1 of 2');
  };

  await run.click();
  const organized = await downloadBytes(page, result);
  await handoff('annotate');
  await page.getByLabel('Note text').fill('Review checkpoint');
  await page.getByLabel('Pages (blank means all)', { exact: true }).fill('1');
  await run.click();
  const annotated = await downloadBytes(page, result);
  await handoff('page-numbers');
  await page.getByLabel('Format').selectOption('page');
  await run.click();
  const numbered = await downloadBytes(page, result);

  const final = await PDFDocument.load(numbered);
  expect(final.getPages().map(sheet => sheet.getWidth())).toEqual([420, 360]);
  const reader = await getDocument({ data: new Uint8Array(numbered), useSystemFonts: true }).promise;
  try {
    const pageText = async (number: number) => (await (await reader.getPage(number)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ');
    const first = await pageText(1), second = await pageText(2);
    expect(first).toContain('Second source page');
    expect(first).toContain('Review checkpoint');
    expect(first).toContain('Page 1');
    expect(second).toContain('First source page');
    expect(second).toContain('Page 2');
    expect(second).not.toContain('Review checkpoint');
  } finally { await reader.destroy(); }

  const previous = page.getByRole('button', { name: /Previous revision/ });
  const next = page.getByRole('button', { name: /Next revision/ });
  await previous.click();
  await expect(page).toHaveURL(/#\/tools\/annotate\/result$/);
  expect(await downloadBytes(page, result)).toEqual(annotated);
  await previous.click();
  await expect(page).toHaveURL(/#\/tools\/organize\/result$/);
  expect(await downloadBytes(page, result)).toEqual(organized);
  await next.click();
  await expect(page).toHaveURL(/#\/tools\/annotate\/result$/);
  await next.click();
  await expect(page).toHaveURL(/#\/tools\/page-numbers\/result$/);
  expect(await downloadBytes(page, result)).toEqual(numbered);
  expect(writes).toEqual([]);
});

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
  const splitBytes = await downloadBytes(page, page.locator('.df2-output[download="split-02.pdf"]'));

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

  const rotatedBytes = await downloadBytes(page, page.locator('.df2-output'));
  const result = await PDFDocument.load(rotatedBytes);
  expect(result.getPageCount()).toBe(1);
  expect(result.getPage(0).getWidth()).toBe(477);
  expect(result.getPage(0).getRotation().angle).toBe(270);

  const previous = page.getByRole('button', { name: /Previous revision/ });
  const next = page.getByRole('button', { name: /Next revision/ });
  await previous.click();
  await expect(page).toHaveURL(/#\/tools\/split\/result$/);
  expect((await downloadBytes(page, page.locator('.df2-output[download="split-02.pdf"]'))).equals(splitBytes)).toBe(true);
  await next.click();
  await expect(page).toHaveURL(/#\/tools\/rotate\/result$/);
  expect((await downloadBytes(page, page.locator('.df2-output'))).equals(rotatedBytes)).toBe(true);

  await previous.click();
  await page.getByRole('button', { name: 'Return to editing' }).click();
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Split method' })).toHaveValue('individual');
  await expect(page.getByRole('combobox', { name: 'Output format' })).toHaveValue('pdfs');
  await page.locator('[data-run]').click();
  await page.getByText('Use PDF in another tool', { exact: true }).click();
  await page.getByRole('combobox', { name: 'PDF result' }).selectOption('0');
  await nextTool.selectOption('merge');
  await page.getByRole('button', { name: 'Open selected PDF' }).click();
  await expect(page.locator('.df2-file')).toContainText('split-01.pdf');
  await expect(next).toBeDisabled();
  const additional = { name: 'additional.pdf', mimeType: 'application/pdf', buffer: splitBytes };
  await page.locator('[data-add-file]').setInputFiles(additional);
  await expect(page.locator('.df2-file')).toHaveCount(2);
  await page.getByRole('button', { name: 'Remove additional.pdf' }).click();
  await expect(page.locator('.df2-file')).toHaveCount(1);
  await page.locator('[data-add-file]').setInputFiles(additional);
  await expect(page.locator('.df2-file')).toHaveCount(2);
  await previous.click();
  await next.click();
  await expect(page).toHaveURL(/#\/tools\/merge\/work$/);
  await expect(page.locator('.df2-file')).toHaveText([/split-01.pdf/, /additional.pdf/]);

  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Start over', exact: true }).click();
  await expect(page.locator('[data-file-input]')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Revision history' })).toHaveCount(0);
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
