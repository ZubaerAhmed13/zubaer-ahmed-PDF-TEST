import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

const base = '/zubaer-ahmed-PDF-TEST/';
async function sample() {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < 4; index++) pdf.addPage([300 + index, 500]);
  return { name: 'split-source.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
}
async function loaded(page: import('@playwright/test').Page) {
  await page.goto(base + '#/tools/split');
  await page.locator('#workspace-file').setInputFiles(await sample());
  await expect(page.locator('.df-page-picker')).toHaveAttribute('data-page-picker-ready','true');
  await expect(page.locator('[data-pick-select]')).toHaveCount(4);
}
async function downloadPages(page: import('@playwright/test').Page): Promise<number[][]> {
  await page.locator('#run-operation').click();
  await expect(page.locator('[data-result-page]')).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.locator('[data-result-page] a[download]').first().click();
  const download = await pending, path = await download.path();
  if (!path) throw new Error('Split result download missing');
  const bytes = await readFile(path);
  if (bytes.slice(0,2).toString() === 'PK') {
    const archive = await JSZip.loadAsync(bytes);
    const entries = Object.values(archive.files).filter(entry => !entry.dir).sort((a,b)=>a.name.localeCompare(b.name));
    const widths: number[][] = [];
    for (const entry of entries) widths.push((await PDFDocument.load(await entry.async('uint8array'))).getPages().map(p=>p.getWidth()));
    return widths;
  }
  return [(await PDFDocument.load(bytes)).getPages().map(p=>p.getWidth())];
}

test('visual split selection switches the existing mode and exports exact pages', async ({page}) => {
  await loaded(page);
  const cards = page.locator('.df-picker-card');
  await cards.nth(1).locator('[data-pick-select]').click();
  await cards.nth(3).locator('[data-pick-select]').click({modifiers:['Shift']});
  await expect(page.locator('select[name="mode"]')).toHaveValue('selected');
  await expect(page.locator('input[name="pages"]')).toHaveValue('2-4');
  await expect(page.locator('[data-pre-edit-preview]')).toBeVisible();
  expect(await downloadPages(page)).toEqual([[301,302,303]]);
});

test('split ranges and individual-page modes remain available and unchanged', async ({page}) => {
  await loaded(page);
  await page.locator('select[name="mode"]').selectOption('ranges');
  await page.locator('input[name="ranges"]').fill('1-2;3-4');
  expect(await downloadPages(page)).toEqual([[300,301],[302,303]]);
});

test('mobile split picker supports tap, full preview and rejects empty selected mode', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await loaded(page);
  const options = page.getByRole('button', { name: 'Options', exact: true });
  await options.click();
  await expect(options).toHaveAttribute('aria-expanded','true');
  await page.locator('select[name="mode"]').selectOption('selected');
  await options.click();
  await page.locator('#run-operation').click();
  await expect(page.locator('[data-picker-alert]')).toContainText('Select at least one page');
  await expect(page.locator('[data-result-page]')).toBeHidden();
  const button = page.getByRole('button',{name:'Enlarge page 3'});
  await button.click();
  const dialog = page.getByRole('dialog',{name:'Page preview'});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'Select page'}).click();
  await expect(page.locator('input[name="pages"]')).toHaveValue('3');
  await expect(button).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  expect(await downloadPages(page)).toEqual([[302]]);
});
