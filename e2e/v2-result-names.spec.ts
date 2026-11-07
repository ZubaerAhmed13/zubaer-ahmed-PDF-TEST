import { expect, test, type Locator, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

const base = '/zubaer-ahmed-PDF-TEST/#/tools/';
async function fixture(name: string, width: number) {
  const pdf = await PDFDocument.create();
  pdf.addPage([width, 500]);
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
}
async function download(page: Page, link: Locator) {
  const pending = page.waitForEvent('download');
  await link.click();
  const output = await pending;
  const path = await output.path();
  if (!path) throw Error('Missing download');
  return { name: output.suggestedFilename(), bytes: await readFile(path) };
}

test('renamed PDFs keep their bytes, extension and name through tool handoff and revisions', async ({ page }) => {
  await page.goto(base + 'rotate');
  await page.locator('[data-file-input]').setInputFiles(await fixture('source.pdf', 410));
  await page.locator('[data-run]').click();
  const first = page.locator('.df2-output');
  const original = await download(page, first);
  await page.getByText('Rename downloads', { exact: true }).click();
  const name = page.getByLabel('Output filename');
  await name.fill('../Reviewed/Copy.PDF');
  await page.getByRole('button', { name: 'Save filename' }).click();
  const renamed = await download(page, first);
  expect(renamed.name).toBe('-Reviewed-Copy.pdf');
  expect(renamed.bytes.equals(original.bytes)).toBe(true);
  expect((await PDFDocument.load(renamed.bytes)).getPage(0).getRotation().angle).toBe(90);

  await page.getByText('Use PDF in another tool', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Next tool' }).selectOption('merge');
  await page.getByRole('button', { name: 'Open selected PDF' }).click();
  await expect(page.locator('.df2-file')).toContainText('-Reviewed-Copy.pdf');
  await page.getByRole('button', { name: /Previous revision/ }).click();
  await expect(first).toHaveAttribute('download', '-Reviewed-Copy.pdf');
});

test('renaming a queue result rejects duplicates and rebuilds an archive with exact renamed bytes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + 'batch');
  await page.locator('[data-file-input]').setInputFiles([
    await fixture('first.pdf', 310), await fixture('second.pdf', 420),
  ]);
  await page.locator('[data-run]').click();
  const outputs = page.locator('.df2-output');
  await expect(outputs).toHaveCount(2);
  const first = await download(page, outputs.nth(0));
  const second = await download(page, outputs.nth(1));
  const prepare = page.getByRole('button', { name: 'Prepare ZIP of completed PDFs' });
  await prepare.click();
  const zip = page.locator('[download="docflow-results.zip"]');
  await expect(zip).toBeVisible();

  await page.getByText('Rename downloads', { exact: true }).click();
  const field = page.getByLabel('Output filename');
  await page.getByLabel('File to rename').selectOption('1');
  await expect(field).toHaveValue(second.name);
  await field.fill(first.name.toUpperCase());
  const save = page.getByRole('button', { name: 'Save filename' });
  await save.click();
  await expect(page.locator('[data-result-rename] [role=status]')).toContainText('already uses that filename');
  await expect(zip).toBeVisible();
  await field.fill('Reviewed second');
  await save.click();
  await expect(zip).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Review completed PDF' }).locator('option').nth(1)).toHaveText('Reviewed second.pdf');
  await prepare.click();
  const archive = await JSZip.loadAsync((await download(page, zip)).bytes);
  expect(Object.keys(archive.files).sort()).toEqual([first.name, 'Reviewed second.pdf'].sort());
  expect(Buffer.from(await archive.file('Reviewed second.pdf')!.async('uint8array')).equals(second.bytes)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
