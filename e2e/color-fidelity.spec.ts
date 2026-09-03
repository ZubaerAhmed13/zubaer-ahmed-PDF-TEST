import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { PDFDocument, rgb } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function colorFixture(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  const patches = [rgb(1, 0, 0), rgb(0, 1, 0), rgb(0, 0, 1), rgb(0.5, 0.5, 0.5)];
  patches.forEach((color, index) => page.drawRectangle({ x: index * 100, y: 0, width: 100, height: 200, color }));
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

async function exportImage(page: Page, format: 'png' | 'jpeg', fixture: Buffer): Promise<Buffer> {
  await page.getByLabel('Search tools').fill('pdf to images');
  await page.locator('#tool-grid [data-open-tool="pdf-to-images"]').click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await dialog.locator('#workspace-file').setInputFiles({ name: 'srgb-patches.pdf', mimeType: 'application/pdf', buffer: fixture });
  await dialog.locator('select[name="format"]').selectOption(format);
  await dialog.locator('select[name="scale"]').selectOption('1');
  await dialog.getByRole('button', { name: 'Run PDF to images' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Complete');
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('link', { name: /^Download pdf-images\.zip/ }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error('Playwright did not expose the image ZIP path.');
  const zip = await JSZip.loadAsync(await readFile(path));
  const extension = format === 'jpeg' ? '.jpg' : '.png';
  const name = Object.keys(zip.files).find((entry) => entry.endsWith(extension));
  if (!name) throw new Error(`No ${extension} page export found in ZIP.`);
  const bytes = Buffer.from(await zip.file(name)!.async('uint8array'));
  await dialog.getByRole('button', { name: 'Close workspace' }).click();
  await expect(dialog).toBeHidden();
  return bytes;
}

async function samplePatches(page: Page, bytes: Buffer): Promise<{ width: number; height: number; samples: number[][] }> {
  const base64 = bytes.toString('base64');
  return page.evaluate(async (encoded) => {
    const binary = atob(encoded);
    const data = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) data[index] = binary.charCodeAt(index);
    const blob = new Blob([data]);
    const bitmap = await createImageBitmap(blob);
    const width = bitmap.width;
    const height = bitmap.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas context unavailable for color certification.');
    context.drawImage(bitmap, 0, 0);
    const positions = [50, 150, 250, 350];
    const samples = positions.map((x) => Array.from(context.getImageData(x, 100, 1, 1).data.slice(0, 3)));
    bitmap.close();
    canvas.width = 1;
    canvas.height = 1;
    return { width, height, samples };
  }, base64);
}

function expectRgb(actual: number[], expected: number[], tolerance: number): void {
  expect(actual).toHaveLength(3);
  actual.forEach((channel, index) => expect(Math.abs(channel - expected[index]!), `${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance));
}

test('PNG and JPEG page exports preserve deterministic sRGB patch colors within defined tolerances', async ({ page }) => {
  test.setTimeout(75_000);
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  const fixture = await colorFixture();
  const expected = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [128, 128, 128]];

  const png = await samplePatches(page, await exportImage(page, 'png', fixture));
  expect([png.width, png.height]).toEqual([400, 200]);
  png.samples.forEach((sample, index) => expectRgb(sample, expected[index]!, 3));

  const jpeg = await samplePatches(page, await exportImage(page, 'jpeg', fixture));
  expect([jpeg.width, jpeg.height]).toEqual([400, 200]);
  jpeg.samples.forEach((sample, index) => expectRgb(sample, expected[index]!, 14));
});
