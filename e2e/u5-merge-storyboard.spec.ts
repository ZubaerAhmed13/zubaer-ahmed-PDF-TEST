import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

const base = '/zubaer-ahmed-PDF-TEST/';
async function inputFile(name: string, width: number) {
  const pdf = await PDFDocument.create();
  pdf.addPage([width, 550]);
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
}
async function open(page: import('@playwright/test').Page) {
  await page.goto(base + '#/tools/merge');
  await page.locator('#workspace-file').setInputFiles([
    await inputFile('alpha.pdf', 310), await inputFile('beta.pdf', 420)
  ]);
  await expect(page.locator('.df-merge-storyboard')).toBeVisible();
  await expect(page.locator('.df-merge-card')).toHaveCount(2);
}
async function exportedWidths(page: import('@playwright/test').Page) {
  await page.locator('#run-operation').click();
  const result = page.locator('[data-result-page]');
  await expect(result).toBeVisible();
  const pending = page.waitForEvent('download');
  await result.getByRole('link', { name: 'Download PDF', exact: true }).first().click();
  const download = await pending, path = await download.path();
  if (!path) throw new Error('Download path unavailable');
  return (await PDFDocument.load(await readFile(path))).getPages().map(p => p.getWidth());
}

test('storyboard move buttons change actual merge bytes and preserve the reader', async ({ page }) => {
  await open(page);
  await expect(page.locator('[data-pre-edit-preview]')).toBeVisible();
  await page.getByRole('button', { name: 'Move beta.pdf left' }).click();
  await expect(page.locator('.df-merge-card').first()).toContainText('beta.pdf');
  await expect(page.locator('#file-list .file-row').first()).toContainText('beta.pdf');
  await expect(page.locator('[data-pre-edit-preview]')).toBeVisible();
  expect(await exportedWidths(page)).toEqual([420,310]);
});

test('storyboard preview opens the existing PDF viewer and mobile controls remain operable', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await open(page);
  await page.getByRole('button', { name: 'Inspect beta.pdf' }).click();
  await expect(page.locator('[data-pre-edit-source="1"]')).toHaveAttribute('aria-current','true');
  await expect(page.locator('.df-merge-card')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.getByRole('button',{name:'Move alpha.pdf right'}).click();
  await expect(page.locator('.df-merge-card').first()).toContainText('beta.pdf');
  expect(await exportedWidths(page)).toEqual([420,310]);
});

test('merge storyboard drag handles reorder sources without rearranging pages within each PDF', async ({ page }) => {
  await open(page);
  const source = page.locator('.df-merge-card').first().locator('[data-storyboard-drag]');
  const target = page.locator('.df-merge-card').nth(1);
  await source.dragTo(target);
  await expect(page.locator('#file-list .file-row').first()).toContainText('beta.pdf');
  await expect(page.locator('.df-merge-card').first()).toContainText('beta.pdf');
  // Reverse with a second real pointer drag to catch stale index handling.
  await page.locator('.df-merge-card').nth(0).locator('[data-storyboard-drag]')
    .dragTo(page.locator('.df-merge-card').nth(1));
  await expect(page.locator('#file-list .file-row').first()).toContainText('alpha.pdf');
  await page.locator('.df-merge-card').nth(0).locator('[data-storyboard-drag]')
    .dragTo(page.locator('.df-merge-card').nth(1));
  await expect(page.locator('#file-list .file-row').first()).toContainText('beta.pdf');
  expect(await exportedWidths(page)).toEqual([420,310]);
});
