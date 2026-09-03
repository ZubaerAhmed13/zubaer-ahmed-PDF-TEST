import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function organizerFixture(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 420]);
  doc.addPage([301, 421]);
  doc.addPage([302, 422]);
  doc.addPage([303, 423]);
  return Buffer.from(await doc.save());
}

test('visual organizer synchronizes duplicate, multi-select delete, undo and move controls with structural export', async ({ page }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.getByLabel('Search tools').fill('organize pages');
  await page.locator('#tool-grid [data-open-tool="organize"]').click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  const order = dialog.locator('input[name="order"]');

  await dialog.locator('#workspace-file').setInputFiles({
    name: 'organizer.pdf',
    mimeType: 'application/pdf',
    buffer: await organizerFixture()
  });
  await expect(dialog.locator('.organizer-panel')).toHaveAttribute('data-organizer-ready', 'true');
  await expect(dialog.locator('.organizer-card')).toHaveCount(4);
  await expect(order).toHaveValue('1,2,3,4');

  const cards = dialog.locator('.organizer-card');
  await cards.nth(1).getByRole('button', { name: 'Duplicate source page 2' }).click();
  await expect(cards).toHaveCount(5);
  await expect(order).toHaveValue('1,2,2,3,4');

  await cards.nth(1).locator('input.organizer-select').check();
  await cards.nth(2).locator('input.organizer-select').check();
  await dialog.getByRole('button', { name: 'Delete selected' }).click();
  await expect(cards).toHaveCount(3);
  await expect(order).toHaveValue('1,3,4');

  await dialog.getByRole('button', { name: 'Undo' }).click();
  await expect(cards).toHaveCount(5);
  await expect(order).toHaveValue('1,2,2,3,4');

  await cards.nth(0).getByRole('button', { name: 'Move source page 1 right' }).click();
  await expect(order).toHaveValue('2,1,2,3,4');

  await dialog.getByRole('button', { name: 'Run Organize pages' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Complete');
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('link', { name: /^Download organized\.pdf/ }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error('Playwright did not expose the organized PDF download path.');

  const output = await PDFDocument.load(await readFile(path));
  expect(output.getPageCount()).toBe(5);
  expect(output.getPages().map((pdfPage) => pdfPage.getWidth())).toEqual([301, 300, 301, 302, 303]);
});

test('advanced deterministic order input remains supported and synchronizes the visual organizer', async ({ page }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.getByLabel('Search tools').fill('organize pages');
  await page.locator('#tool-grid [data-open-tool="organize"]').click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await dialog.locator('#workspace-file').setInputFiles({
    name: 'organizer-advanced.pdf',
    mimeType: 'application/pdf',
    buffer: await organizerFixture()
  });
  await expect(dialog.locator('.organizer-panel')).toHaveAttribute('data-organizer-ready', 'true');

  const order = dialog.locator('input[name="order"]');
  await order.fill('4,2,2,1');
  await expect(dialog.locator('.organizer-card')).toHaveCount(4);
  await expect(dialog.locator('.organizer-card').nth(0)).toHaveAttribute('data-source-page', '4');
  await expect(dialog.locator('.organizer-card').nth(1)).toHaveAttribute('data-source-page', '2');
  await expect(dialog.locator('.organizer-card').nth(2)).toHaveAttribute('data-source-page', '2');
  await expect(dialog.locator('.organizer-card').nth(3)).toHaveAttribute('data-source-page', '1');
});
