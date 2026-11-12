import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

const base = '/zubaer-ahmed-PDF-TEST/#/tools/';
async function open(page: Page, tool: string) {
  const pdf = await PDFDocument.create();
  for (let n = 0; n < 4; n++) pdf.addPage([300 + n, 500]);
  await page.goto(base + tool);
  await page.locator('[data-file-input]').setInputFiles({
    name: 'four-pages.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save())
  });
  await expect(page.getByRole('button', { name: 'Select page 4', exact: true })).toBeVisible();
}
async function runAndDownload(page: Page) {
  await page.locator('[data-run]').click();
  const output = page.locator('.df2-output').first();
  await expect(output).toBeVisible();
  const pending = page.waitForEvent('download');
  await output.click();
  const path = await (await pending).path();
  if (!path) throw Error('Missing output');
  return readFile(path);
}

test('typed extract ranges and thumbnail selection stay in sync through export and return', async ({ page }) => {
  await open(page, 'extract-pages');
  const field = page.getByLabel('Pages to extract', { exact: true });
  const thumbnail = (n: number) => page.getByRole('button', { name: 'Select page ' + n, exact: true });
  await field.fill('4, 2');
  await expect(thumbnail(2)).toHaveAttribute('aria-pressed', 'true');
  await expect(thumbnail(4)).toHaveAttribute('aria-pressed', 'true');
  await field.fill('9');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await thumbnail(1).click();
  await expect(field).toHaveValue('9');
  await page.locator('[data-run]').click();
  await expect(page.locator('[data-run-status]')).toContainText('Invalid page number: 9');
  await expect(page.locator('.df2-output')).toHaveCount(0);
  await field.fill('4, 2');
  await thumbnail(1).click();
  await expect(field).toHaveValue('1-2,4');
  const pdf = await PDFDocument.load(await runAndDownload(page));
  expect(pdf.getPages().map(p => p.getWidth())).toEqual([300, 301, 303]);
  await page.getByRole('button', { name: 'Return to editing' }).click();
  await expect(thumbnail(4)).toHaveAttribute('aria-pressed', 'true');
  await expect(thumbnail(3)).toHaveAttribute('aria-pressed', 'false');
});

test('phone Remove pages blocks deleting every page and keeps preview controls usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'remove-pages');
  const group = page.getByRole('group', { name: 'Page selection' });
  const all = group.getByRole('button', { name: 'Select all pages' });
  await all.press('Enter');
  await expect(group.getByRole('status')).toHaveText('4 of 4 selected');
  await expect(all).toBeFocused();
  await page.locator('[data-run]').click();
  await expect(page.locator('[data-run-status]')).toContainText('Keep at least one page');
  await expect(page.locator('.df2-output')).toHaveCount(0);
  await page.getByRole('button', { name: 'Select page 2', exact: true }).click();
  await expect(page.locator('[data-page-label]')).toHaveText('Page 2 / 4');
  await expect(group.getByRole('status')).toHaveText('3 of 4 selected');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  const audit = await new AxeBuilder({ page }).include('.df2-page-selection')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  expect(audit.violations).toEqual([]);
  const pdf = await PDFDocument.load(await runAndDownload(page));
  expect(pdf.getPages().map(p => p.getWidth())).toEqual([301]);
});

test('Split rejects empty selections and Shift-click switches to the exact selected pages', async ({ page }) => {
  await open(page, 'split');
  const method = page.getByRole('combobox', { name: 'Split method' });
  const field = page.getByLabel('Pages to extract', { exact: true });
  await field.fill('');
  await page.locator('[data-run]').click();
  await expect(page.locator('[data-run-status]')).toContainText('Select at least one page');
  await expect(page.locator('.df2-output')).toHaveCount(0);
  await method.selectOption('ranges');
  await page.getByLabel('Separate ranges (semicolon)', { exact: true }).fill('1; ;3');
  await page.locator('[data-run]').click();
  await expect(page.locator('[data-run-status]')).toContainText('Each split range needs at least one page');
  await expect(page.locator('.df2-output')).toHaveCount(0);
  await page.getByRole('button', { name: 'Select page 2', exact: true }).click();
  await page.getByRole('button', { name: 'Select page 4', exact: true }).click({ modifiers: ['Shift'] });
  await expect(method).toHaveValue('selected');
  await expect(field).toHaveValue('2-4');
  const zip = await JSZip.loadAsync(await runAndDownload(page));
  expect(Object.keys(zip.files)).toEqual(['split-01.pdf']);
  const pdf = await PDFDocument.load(await zip.file('split-01.pdf')!.async('uint8array'));
  expect(pdf.getPages().map(p => p.getWidth())).toEqual([301, 302, 303]);
  await page.getByRole('button', { name: 'Return to editing' }).click();
  await page.getByRole('button', { name: 'Clear page selection' }).click();
  await expect(field).toHaveValue('');
  await method.selectOption('ranges');
  await page.getByLabel('Separate ranges (semicolon)', { exact: true }).fill('1-2;3-4');
  const ranged = await JSZip.loadAsync(await runAndDownload(page));
  const widths = [];
  for (const name of ['split-01.pdf', 'split-02.pdf']) {
    const part = await PDFDocument.load(await ranged.file(name)!.async('uint8array'));
    widths.push(part.getPages().map(p => p.getWidth()));
  }
  expect(widths).toEqual([[300, 301], [302, 303]]);
});

test('malformed extract ranges never publish a PDF and valid decimal selections recover', async ({ page }) => {
  await open(page, 'extract-pages');
  const field = page.getByLabel('Pages to extract', { exact: true });
  for (const invalid of ['1,,3', '0x2', '2.0', '1,']) {
    await field.fill(invalid);
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await page.locator('[data-run]').click();
    await expect(page.locator('[data-run-status]')).toContainText(/Invalid page|missing page/);
    await expect(page.locator('.df2-output')).toHaveCount(0);
  }
  await field.fill('01, 3');
  await expect(field).not.toHaveAttribute('aria-invalid', 'true');
  const result = await PDFDocument.load(await runAndDownload(page));
  expect(result.getPages().map(p => p.getWidth())).toEqual([300, 302]);
});

test('split rejects repeated semicolons before export, then produces exact separate ranges', async ({ page }) => {
  await open(page, 'split');
  await page.getByRole('combobox', { name: 'Split method' }).selectOption('ranges');
  const field = page.getByLabel('Separate ranges (semicolon)', { exact: true });
  await field.fill('1;;3');
  await page.locator('[data-run]').click();
  await expect(page.locator('[data-run-status]')).toContainText('Each split range needs at least one page');
  await expect(page.locator('.df2-output')).toHaveCount(0);
  await field.fill('1;3');
  const zip = await JSZip.loadAsync(await runAndDownload(page));
  const names = Object.keys(zip.files).sort();
  expect(names).toEqual(['split-01.pdf', 'split-02.pdf']);
  const first = await PDFDocument.load(await zip.file('split-01.pdf')!.async('uint8array'));
  const second = await PDFDocument.load(await zip.file('split-02.pdf')!.async('uint8array'));
  expect([first.getPage(0).getWidth(), second.getPage(0).getWidth()]).toEqual([300, 302]);
});
