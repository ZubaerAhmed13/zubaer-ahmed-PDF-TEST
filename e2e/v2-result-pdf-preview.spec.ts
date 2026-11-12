import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, rgb } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function upload(page: Page, tool: string) {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 500]).drawRectangle({ x: 0, y: 0, width: 300, height: 500, color: rgb(1, 0, 0) });
  pdf.addPage([500, 300]).drawRectangle({ x: 0, y: 0, width: 500, height: 300, color: rgb(0, 0, 1) });
  await page.goto('/zubaer-ahmed-PDF-TEST/#/tools/' + tool);
  await page.locator('[data-file-input]').setInputFiles({
    name: 'two-colours.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()),
  });
}

test('reviews each rotated page from the downloadable result and releases the canvas on close', async ({ page }) => {
  await upload(page, 'rotate');
  await page.locator('[data-run]').click();
  const review = page.getByText('Preview exported PDF', { exact: true });
  const canvas = page.locator('[data-pdf-review-canvas]');
  await expect(review).toBeVisible();
  await expect(canvas).toHaveCount(0);
  await review.click();
  await expect(page.locator('[data-pdf-review-status]')).toContainText('Page 1 / 2');
  await expect.poll(() => canvas.evaluate(node => node instanceof HTMLCanvasElement && node.width > node.height)).toBe(true);
  await page.getByRole('button', { name: 'Next output page' }).click();
  await expect(page.locator('[data-pdf-review-status]')).toContainText('Page 2 / 2');
  expect(await canvas.evaluate(node => {
    const surface = node as HTMLCanvasElement;
    return [...surface.getContext('2d')!.getImageData(surface.width >> 1, surface.height >> 1, 1, 1).data];
  })).toEqual([0, 0, 255, 255]);
  await review.click();
  await expect(canvas).toHaveCount(0);

  const pending = page.waitForEvent('download');
  await page.locator('.df2-output').click();
  const path = await (await pending).path();
  if (!path) throw Error('Missing rotated PDF');
  const exported = await PDFDocument.load(await readFile(path));
  expect(exported.getPages().map(p => p.getRotation().angle)).toEqual([90, 90]);
});

test('phone preview switches between split PDFs and follows a renamed output', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await upload(page, 'split');
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.getByRole('combobox', { name: 'Split method' }).selectOption('individual');
  await page.getByRole('combobox', { name: 'Output format' }).selectOption('pdfs');
  await page.locator('[data-run]').click();
  const open = page.getByText('Preview exported PDF', { exact: true });
  await expect(open).toBeVisible();
  await open.click();
  const picker = page.getByRole('combobox', { name: 'PDF to preview' });
  await picker.selectOption('1');
  await expect(page.getByRole('heading', { name: 'split-02.pdf', exact: true })).toBeVisible();
  await expect(page.locator('[data-pdf-review-status]')).toContainText('Page 1 / 1');
  expect(await page.locator('[data-pdf-review-canvas]').evaluate(node => {
    const surface = node as HTMLCanvasElement;
    return [...surface.getContext('2d')!.getImageData(surface.width >> 1, surface.height >> 1, 1, 1).data];
  })).toEqual([0, 0, 255, 255]);

  await page.getByText('Rename downloads', { exact: true }).click();
  await page.getByLabel('File to rename').selectOption('1');
  await page.getByLabel('Output filename').fill('Blue page');
  await page.getByRole('button', { name: 'Save filename' }).click();
  await expect(picker.locator('option:checked')).toHaveText('Blue page.pdf');
  await expect(page.getByRole('heading', { name: 'Blue page.pdf', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
