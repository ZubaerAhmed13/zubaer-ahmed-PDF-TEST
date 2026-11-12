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

async function mockFileSharing(page: Page) {
  await page.addInitScript(() => {
    const state = { calls: [] as { name: string; type: string; bytes: number[] }[], cancel: true };
    Object.assign(window, { docflowShareTest: state });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: (data: ShareData) => data.files?.length === 1 });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => {
      const file = data.files![0]!;
      state.calls.push({ name: file.name, type: file.type, bytes: [...new Uint8Array(await file.arrayBuffer())] });
      if (state.cancel) throw new DOMException('Cancelled by the user', 'AbortError');
    } });
  });
}

test('device sharing uses the renamed download bytes and cancellation leaves the download available', async ({ page }) => {
  await mockFileSharing(page);
  await page.goto(base + 'rotate');
  await page.locator('[data-file-input]').setInputFiles(await fixture('share-source.pdf', 410));
  await page.locator('[data-run]').click();
  const link = page.locator('.df2-output');
  await expect(link).toBeVisible();
  await page.getByText('Rename downloads', { exact: true }).click();
  await page.getByLabel('Output filename').fill('Shared copy');
  await page.getByRole('button', { name: 'Save filename' }).click();
  const share = page.getByRole('button', { name: 'Save / share Shared copy.pdf' });
  await share.click();
  await expect(page.getByText('Sharing cancelled. Your download is still available.')).toBeVisible();
  await expect(share).toBeEnabled();
  const renamed = await download(page, link);
  expect(renamed.name).toBe('Shared copy.pdf');
  expect((await PDFDocument.load(renamed.bytes)).getPage(0).getRotation().angle).toBe(90);
  await page.evaluate(() => { (window as unknown as { docflowShareTest: { cancel: boolean } }).docflowShareTest.cancel = false; });
  await share.click();
  await expect(page.getByText('Sent to the selected share destination.')).toBeVisible();
  const calls = await page.evaluate(() => (window as unknown as { docflowShareTest: { calls: unknown[] } }).docflowShareTest.calls);
  expect(calls).toEqual(Array(2).fill({ name: renamed.name, type: 'application/pdf', bytes: [...renamed.bytes] }));
});

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
  await mockFileSharing(page);
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
  const shareZip = page.getByRole('button', { name: 'Save / share docflow-results.zip' });
  await expect(zip).toBeVisible();
  await expect(shareZip).toBeVisible();

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
  await expect(shareZip).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Review completed PDF' }).locator('option').nth(1)).toHaveText('Reviewed second.pdf');
  await prepare.click();
  const zipBytes = (await download(page, zip)).bytes;
  const archive = await JSZip.loadAsync(zipBytes);
  expect(Object.keys(archive.files).sort()).toEqual([first.name, 'Reviewed second.pdf'].sort());
  expect(Buffer.from(await archive.file('Reviewed second.pdf')!.async('uint8array')).equals(second.bytes)).toBe(true);
  await shareZip.click();
  await expect(page.getByText('Sharing cancelled. Your download is still available.')).toBeVisible();
  const calls = await page.evaluate(() => (window as unknown as { docflowShareTest: { calls: unknown[] } }).docflowShareTest.calls);
  expect(calls).toEqual([{ name: 'docflow-results.zip', type: 'application/zip', bytes: [...zipBytes] }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test('download filenames cannot hide their extension with invisible direction controls', async ({ page }) => {
  await page.goto(base + 'rotate');
  await page.locator('[data-file-input]').setInputFiles(await fixture('source.pdf', 410));
  await page.locator('[data-run]').click();
  const link = page.locator('.df2-output');
  await expect(link).toBeVisible();
  await page.getByText('Rename downloads', { exact: true }).click();
  await page.getByLabel('Output filename').fill('invoice\\u202epdf\\u202c.PDF');
  await page.getByRole('button', { name: 'Save filename' }).click();
  await expect(link).toHaveAttribute('download', 'invoice-pdf-.pdf');
  const renamed = await download(page, link);
  expect(renamed.name).toBe('invoice-pdf-.pdf');
  expect((await PDFDocument.load(renamed.bytes)).getPage(0).getRotation().angle).toBe(90);
});
