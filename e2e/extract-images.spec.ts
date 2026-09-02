import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';

const TWO_BY_TWO_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGElEQVR4nAXBAQEAAAjDIG7/zhNE0k3CAz7tBf5/xlWuAAAAAElFTkSuQmCC', 'base64');

async function embeddedImagePdf(): Promise<Buffer> {
  const document = await PDFDocument.create();
  const image = await document.embedPng(TWO_BY_TWO_PNG);
  const page = document.addPage([300, 300]);
  page.drawImage(image, { x: 40, y: 60, width: 120, height: 120 });
  return Buffer.from(await document.save());
}

test('extracts decoded embedded raster images without rendering whole pages', async ({ page }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.getByLabel('Search tools').fill('extract images');
  await expect(page.getByRole('heading', { name: 'Extract images' })).toBeVisible();
  await page.getByRole('button', { name: 'Open tool' }).click();

  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  await dialog.locator('#workspace-file').setInputFiles({
    name: 'embedded-image.pdf',
    mimeType: 'application/pdf',
    buffer: await embeddedImagePdf()
  });
  await dialog.getByRole('button', { name: 'Run Extract images' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Complete');
  await expect(dialog.getByText(/embedded raster image/)).toBeVisible();

  const link = dialog.getByRole('link', { name: /Download embedded-images\.zip/ });
  await expect(link).toBeVisible();
  const href = await link.getAttribute('href');
  expect(href).toBeTruthy();
  const bytes = await page.evaluate(async (url) => {
    const response = await fetch(url);
    return Array.from(new Uint8Array(await response.arrayBuffer()));
  }, href!);

  const zip = await JSZip.loadAsync(Uint8Array.from(bytes));
  const pngNames = Object.keys(zip.files).filter((name) => name.endsWith('.png'));
  expect(pngNames.length).toBeGreaterThanOrEqual(1);
  const extracted = await zip.file(pngNames[0]!)!.async('uint8array');
  expect(Array.from(extracted.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

  const manifestText = await zip.file('manifest.json')!.async('string');
  const manifest = JSON.parse(manifestText) as { extractedImages: number; images: Array<{ width: number; height: number }> };
  expect(manifest.extractedImages).toBeGreaterThanOrEqual(1);
  expect(manifest.images[0]?.width).toBe(2);
  expect(manifest.images[0]?.height).toBe(2);
});
