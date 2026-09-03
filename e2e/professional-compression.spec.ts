import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, StandardFonts, rgb } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

interface PdfImageInfo { width: number; height: number; bytes: number }

async function makeSourceJpeg(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1800;
    canvas.height = 1200;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable for compression fixture.');
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#ef4444');
    gradient.addColorStop(0.33, '#22c55e');
    gradient.addColorStop(0.66, '#3b82f6');
    gradient.addColorStop(1, '#f59e0b');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalAlpha = 0.28;
    for (let y = 0; y < canvas.height; y += 18) {
      for (let x = 0; x < canvas.width; x += 18) {
        const value = (x * 17 + y * 31) % 255;
        context.fillStyle = `rgb(${value},${(value * 3) % 255},${(value * 7) % 255})`;
        context.fillRect(x, y, 10, 10);
      }
    }
    context.globalAlpha = 1;
    context.fillStyle = '#ffffff';
    context.font = 'bold 92px sans-serif';
    context.fillText('DOCFLOW JPEG QUALITY FIXTURE', 90, 190);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('JPEG fixture encoding failed.')), 'image/jpeg', 0.98));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunk) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
    return btoa(binary);
  });
  return Buffer.from(base64, 'base64');
}

async function pdfFixture(page: Page): Promise<Buffer> {
  const jpg = await makeSourceJpeg(page);
  const doc = await PDFDocument.create();
  const pdfPage = doc.addPage([595.28, 841.89]);
  const image = await doc.embedJpg(jpg);
  pdfPage.drawImage(image, { x: 47.64, y: 220, width: 500, height: 333.33 });
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  pdfPage.drawText('VECTOR TEXT MUST REMAIN STRUCTURAL', { x: 64, y: 660, size: 22, font, color: rgb(0.1, 0.1, 0.1) });
  pdfPage.drawRectangle({ x: 64, y: 610, width: 460, height: 18, color: rgb(0.1, 0.35, 0.75) });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

function jpegImages(doc: PDFDocument): PdfImageInfo[] {
  const subtype = PDFName.of('Subtype');
  const image = PDFName.of('Image');
  const filter = PDFName.of('Filter');
  const dct = PDFName.of('DCTDecode');
  const width = PDFName.of('Width');
  const height = PDFName.of('Height');
  const result: PdfImageInfo[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const subtypeValue = object.dict.get(subtype);
    const filterValue = object.dict.get(filter);
    if (!(subtypeValue instanceof PDFName) || subtypeValue.asString() !== image.asString()) continue;
    if (!(filterValue instanceof PDFName) || filterValue.asString() !== dct.asString()) continue;
    result.push({
      width: object.dict.lookup(width, PDFNumber).asNumber(),
      height: object.dict.lookup(height, PDFNumber).asNumber(),
      bytes: object.getContentsSize()
    });
  }
  return result;
}

test('professional optimizer selectively recompresses RGB JPEG XObjects without page rasterization', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  const source = await pdfFixture(page);
  const sourceDoc = await PDFDocument.load(source);
  const sourceImages = jpegImages(sourceDoc);
  expect(sourceImages).toHaveLength(1);
  expect(sourceImages[0]).toMatchObject({ width: 1800, height: 1200 });

  await page.getByLabel('Search tools').fill('optimize');
  await page.locator('#tool-grid [data-open-tool="compress"]').click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog.getByText('Selective JPEG image recompression')).toBeVisible();
  await dialog.locator('#workspace-file').setInputFiles({ name: 'image-heavy.pdf', mimeType: 'application/pdf', buffer: source });
  await dialog.locator('input[name="imageQuality"]').fill('0.70');
  await dialog.locator('input[name="maxImageDimension"]').fill('1000');
  await dialog.getByRole('button', { name: 'Run Optimize PDF' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Complete', { timeout: 60_000 });
  await expect(dialog.locator('#result')).toContainText('recompressedImages');

  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('link', { name: /^Download optimized\.pdf/ }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error('Playwright did not expose the optimized PDF path.');
  const outputBytes = await readFile(path);

  const output = await PDFDocument.load(outputBytes);
  expect(output.getPageCount()).toBe(1);
  expect(output.getPage(0).getWidth()).toBeCloseTo(595.28, 1);
  expect(output.getPage(0).getHeight()).toBeCloseTo(841.89, 1);
  const outputImages = jpegImages(output);
  expect(outputImages).toHaveLength(1);
  expect(Math.max(outputImages[0]!.width, outputImages[0]!.height)).toBeLessThanOrEqual(1000);
  expect(outputImages[0]!.bytes).toBeLessThan(sourceImages[0]!.bytes * 0.8);
  expect(outputBytes.byteLength).toBeLessThan(source.byteLength * 0.9);

  await dialog.getByRole('button', { name: 'Close workspace' }).click();
  await page.getByLabel('Search tools').fill('view pdf');
  await page.locator('#tool-grid [data-open-tool="preview"]').click();
  const preview = page.getByRole('dialog', { name: 'Workspace' });
  await preview.locator('#workspace-file').setInputFiles({ name: 'optimized.pdf', mimeType: 'application/pdf', buffer: outputBytes });
  await preview.getByRole('button', { name: 'Run View PDF' }).click();
  await expect(preview.locator('#stage')).toHaveText('Preview ready');
  await expect(preview.locator('#viewer-status')).toHaveText('Page 1 of 1');
  const canvas = await preview.locator('#pdf-canvas').evaluate((element: HTMLCanvasElement) => ({ width: element.width, height: element.height }));
  expect(canvas.width).toBeGreaterThan(1);
  expect(canvas.height).toBeGreaterThan(1);
});
