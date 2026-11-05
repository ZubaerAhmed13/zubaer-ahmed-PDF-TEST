import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

const base = '/zubaer-ahmed-PDF-TEST/';

test('opens the selected split PDF in a second tool without uploading again', async ({ page }) => {
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
  await page.locator('[data-run]').click();
  await expect(page.locator('.df2-output')).toHaveCount(2);

  await page.getByText('Use PDF in another tool', { exact: true }).click();
  await page.getByRole('combobox', { name: 'PDF result' }).selectOption('1');
  await expect(page.getByRole('option', { name: 'Images to PDF', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Next tool' }).selectOption('rotate');
  await page.getByRole('button', { name: 'Open selected PDF' }).click();
  await expect(page).toHaveURL(/#\/tools\/rotate\/work$/);
  await expect(page.locator('.df2-file')).toHaveCount(1);
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
