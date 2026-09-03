import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

const SCAN_WIDTH = 2480;
const SCAN_HEIGHT = 3508;
const A4_POINTS: [number, number] = [595.28, 841.89];

async function highResolutionScanFixture(page: Page): Promise<Buffer> {
  const scans = await page.evaluate(({ width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas is unavailable for the scan fixture.');

    const pages: string[] = [];
    for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
      context.fillStyle = '#f7f5ef';
      context.fillRect(0, 0, width, height);

      context.fillStyle = '#222';
      context.font = 'bold 72px sans-serif';
      context.fillText(`DocFlow 300 DPI scan ${pageIndex + 1}`, 150, 180);
      context.font = '32px sans-serif';
      context.fillText('A4 raster certification fixture · 2480 × 3508 px', 150, 245);

      for (let row = 0; row < 68; row += 1) {
        const y = 330 + row * 43;
        const shade = 42 + ((row * 17 + pageIndex * 23) % 75);
        context.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
        const widthFactor = 0.52 + ((row * 37 + pageIndex * 11) % 41) / 100;
        context.fillRect(155, y, Math.floor((width - 310) * widthFactor), 11 + (row % 4));
        if (row % 9 === 0) {
          context.strokeStyle = '#8b8b8b';
          context.lineWidth = 2;
          context.strokeRect(145, y - 15, width - 290, 34);
        }
      }

      context.fillStyle = '#555';
      context.font = '28px monospace';
      for (let block = 0; block < 8; block += 1) {
        context.fillText(`SCAN-${pageIndex + 1}-${String(block + 1).padStart(2, '0')}  Local raster evidence`, 160, 3270 + block * 28);
      }

      pages.push(canvas.toDataURL('image/jpeg', 0.86));
    }
    return pages;
  }, { width: SCAN_WIDTH, height: SCAN_HEIGHT });

  const doc = await PDFDocument.create();
  doc.setTitle('DocFlow A4 300 DPI raster scan certification fixture');
  for (const dataUrl of scans) {
    const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const jpeg = await doc.embedJpg(Buffer.from(encoded, 'base64'));
    expect(jpeg.width).toBe(SCAN_WIDTH);
    expect(jpeg.height).toBe(SCAN_HEIGHT);
    const pdfPage = doc.addPage(A4_POINTS);
    pdfPage.drawImage(jpeg, { x: 0, y: 0, width: A4_POINTS[0], height: A4_POINTS[1] });
  }
  return Buffer.from(await doc.save({ useObjectStreams: true }));
}

test('previews and structurally edits a three-page A4 300-DPI raster scan without dropping image content', async ({ page }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  const fixture = await highResolutionScanFixture(page);
  expect(fixture.byteLength).toBeGreaterThan(200_000);
  expect(fixture.toString('latin1')).toContain('/DCTDecode');

  await page.getByLabel('Search tools').fill('view pdf');
  await page.locator('#tool-grid [data-open-tool="preview"]').click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await dialog.locator('#workspace-file').setInputFiles({
    name: 'a4-300dpi-raster-scan.pdf',
    mimeType: 'application/pdf',
    buffer: fixture
  });
  await dialog.getByRole('button', { name: 'Run View PDF' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Preview ready', { timeout: 60_000 });
  await expect(dialog.locator('#viewer-status')).toHaveText('Page 1 of 3');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.locator('#viewer-status')).toHaveText('Page 2 of 3');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.locator('#viewer-status')).toHaveText('Page 3 of 3');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await page.getByLabel('Search tools').fill('rotate');
  await page.locator('#tool-grid [data-open-tool="rotate"]').click();
  await expect(dialog).toBeVisible();
  await dialog.locator('#workspace-file').setInputFiles({
    name: 'a4-300dpi-raster-scan.pdf',
    mimeType: 'application/pdf',
    buffer: fixture
  });
  await dialog.locator('select[name="degrees"]').selectOption('90');
  await dialog.getByRole('button', { name: 'Run Rotate pages' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Complete', { timeout: 60_000 });

  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('link', { name: /Download rotated\.pdf/ }).click();
  const path = await (await downloadPromise).path();
  if (!path) throw new Error('Playwright did not expose the rotated high-resolution PDF path.');
  const output = await readFile(path);
  expect(output.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  expect(output.toString('latin1')).toContain('/DCTDecode');

  const reopened = await PDFDocument.load(output);
  expect(reopened.getPageCount()).toBe(3);
  expect(reopened.getPages().map((pdfPage) => pdfPage.getRotation().angle)).toEqual([90, 90, 90]);
  expect(reopened.getPages().map((pdfPage) => [Math.round(pdfPage.getWidth() * 100) / 100, Math.round(pdfPage.getHeight() * 100) / 100])).toEqual([
    A4_POINTS,
    A4_POINTS,
    A4_POINTS
  ]);
});
