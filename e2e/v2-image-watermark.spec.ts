import { expect, test } from '@playwright/test';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

async function pdfFixture(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([420, 620]).drawText('Original first page', { x: 24, y: 540 });
  doc.addPage([500, 700]).drawText('Original second page', { x: 24, y: 620 });
  return Buffer.from(await doc.save());
}

test('adds a PNG image watermark through the UI and reopens a structurally valid PDF', async ({ page }) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlRYpkAAAAASUVORK5CYII=', 'base64');
  await page.goto('/zubaer-ahmed-PDF-TEST/#/tools/watermark');
  await page.locator('[data-file-input]').setInputFiles({ name: 'source.pdf', mimeType: 'application/pdf', buffer: await pdfFixture() });
  const mode = page.getByLabel('Watermark type');
  await expect(mode).toBeVisible();
  await mode.selectOption('image');
  const image = page.getByLabel('Watermark image');
  await expect(image).toBeVisible();
  await page.locator('[data-run]').click();
  await expect(page.locator('[data-run-status]')).toContainText('Choose a PNG or JPEG watermark image');
  await image.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await page.getByLabel('Image width (% of page)').fill('30');
  await page.getByLabel('Image position').selectOption('bottom-right');
  await page.getByLabel('Edge margin (pt)').fill('18');
  await page.getByLabel(/Opacity/).fill('0.4');
  await page.locator('[data-run]').click();
  await expect(page.locator('.df2-result')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('.df2-output').first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('watermarked-image.pdf');
  const path = await download.path();
  if (!path) throw new Error('Playwright did not expose the image-watermarked download path.');

  const bytes = await readFile(path);
  const output = await PDFDocument.load(bytes);
  expect(output.getPageCount()).toBe(2);
  for (const pdfPage of output.getPages()) {
    expect(pdfPage.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict).keys()).toHaveLength(1);
    expect(pdfPage.node.Resources()?.lookup(PDFName.of('Font'), PDFDict).keys()).toHaveLength(1);
  }
  const parsed = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  try {
    for (const [index, expected] of ['Original first page', 'Original second page'].entries()) {
      const content = await (await parsed.getPage(index + 1)).getTextContent();
      expect(content.items.map(item => 'str' in item ? item.str : '').join('')).toContain(expected);
    }
  } finally { await parsed.destroy(); }

  await page.locator('[data-return-edit]').click();
  await expect(mode).toHaveValue('image');
  await expect(page.getByText(/logo\.png/)).toBeVisible();
  await expect(page.getByLabel('Image width (% of page)')).toHaveValue('30');
  await mode.selectOption('text');
  await expect(image).toBeHidden();
  await expect(page.getByLabel('Watermark text')).toBeVisible();
});
