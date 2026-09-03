import { expect, test } from '@playwright/test';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function pdfFixture(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([420, 620]);
  doc.addPage([500, 700]);
  return Buffer.from(await doc.save());
}

test('adds a PNG image watermark through the UI and reopens a structurally valid PDF', async ({ page }) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlRYpkAAAAASUVORK5CYII=', 'base64');
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.getByLabel('Search tools').fill('watermark');
  await page.locator('#tool-grid [data-open-tool="watermark"]').click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });

  await dialog.locator('#workspace-file').setInputFiles({ name: 'source.pdf', mimeType: 'application/pdf', buffer: await pdfFixture() });
  await dialog.getByLabel('Watermark type').selectOption('image');
  await expect(dialog.locator('[data-image-watermark-controls]')).toBeVisible();
  await dialog.locator('#watermark-image-file').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await dialog.locator('input[name="imageWidthPercent"]').fill('30');
  await dialog.locator('select[name="imagePosition"]').selectOption('bottom-right');
  await dialog.locator('input[name="imageMargin"]').fill('18');
  await dialog.locator('input[name="opacity"]').fill('0.4');

  await dialog.getByRole('button', { name: 'Run Add watermark' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Complete');
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('link', { name: /^Download watermarked-image\.pdf/ }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error('Playwright did not expose the image-watermarked download path.');

  const bytes = await readFile(path);
  const output = await PDFDocument.load(bytes);
  expect(output.getPageCount()).toBe(2);
  const resources = output.getPage(0).node.Resources();
  const xObjects = resources?.lookup(PDFName.of('XObject'), PDFDict);
  expect(xObjects?.keys().length ?? 0).toBeGreaterThan(0);
});
