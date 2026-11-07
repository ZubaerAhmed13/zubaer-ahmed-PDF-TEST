import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
const base='/zubaer-ahmed-PDF-TEST/';
test('new image-to-PDF workflow previews source images and exports real PDF pages',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(base+'#/tools/images-to-pdf');
  const [first,second]=await Promise.all([
    readFile('tests/fixtures/ocr-corpus/eng-sans.png'),
    readFile('tests/fixtures/ocr-corpus/deu-sans.png')
  ]);
  await page.locator('[data-file-input]').setInputFiles([
    {name:'English sample.png',mimeType:'image/png',buffer:first},
    {name:'German sample.png',mimeType:'image/png',buffer:second}
  ]);
  await expect(page.locator('.df2-image-thumb')).toHaveCount(2);
  await expect(page.locator('[data-render-status]')).toContainText('Image 1 of 2');
  const canvas=page.locator('[data-page-canvas]');
  await expect.poll(async()=>canvas.evaluate(el=>(el as HTMLCanvasElement).width)).toBeGreaterThan(100);
  await page.getByRole('button',{name:/Preview image 2/}).click();
  await expect(page.locator('[data-render-status]')).toContainText('Image 2 of 2');
  await page.getByRole('button',{name:'Options',exact:true}).click();
  await page.locator('select[name=pageSize]').selectOption('letter');
  await page.locator('select[name=orientation]').selectOption('portrait');
  await page.locator('input[name=margin]').fill('50');
  await page.getByRole('button',{name:'Close options'}).click();
  await page.getByRole('button',{name:'Move German sample.png up'}).click();
  await expect(page.locator('.df2-file').first()).toContainText('German sample.png');
  await expect(page.locator('select[name=pageSize]')).toHaveValue('letter');
  await expect(page.locator('select[name=orientation]')).toHaveValue('portrait');
  await expect(page.locator('input[name=margin]')).toHaveValue('50');
  await page.locator('[data-run]').click();
  await expect(page.locator('.df2-result')).toBeVisible();
  const pending=page.waitForEvent('download');
  await page.locator('.df2-output').first().click();
  const download=await pending;
  const path=await download.path();if(!path)throw Error('Download unavailable');
  const output=await PDFDocument.load(await readFile(path));
  expect(output.getPageCount()).toBe(2);
  expect(output.getPages().every(p=>p.getWidth()===612&&p.getHeight()===792)).toBe(true);
});

test('photo corrections stay with the selected file through reorder, cancellation and return to editing', async ({ page }) => {
  await page.goto(base+'#/tools/images-to-pdf');
  const camera = page.getByLabel('Take a photo', { exact: true });
  await expect(camera).toHaveAttribute('capture', 'environment');
  await camera.focus();
  await expect(camera.locator('..')).toHaveCSS('outline-style', 'solid');
  const photos = await page.evaluate(() => [[1000, 600, '#c05030'], [300, 400, '#3070b0']].map(([width, height, color]) => {
    const canvas = document.createElement('canvas');
    canvas.width = Number(width);
    canvas.height = Number(height);
    const context = canvas.getContext('2d')!;
    context.fillStyle = String(color);
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'white';
    context.fillRect(100, 100, 80, 60);
    return canvas.toDataURL('image/png').split(',')[1]!;
  }));
  const inputs = photos.map((data, index) => ({
    name: `photo-${index + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64')
  }));
  await camera.setInputFiles(inputs[0]!);
  await expect(page.locator('.df2-file')).toHaveCount(1);
  await page.locator('[data-add-file]').setInputFiles(inputs[1]!);
  await expect(page.locator('.df2-file')).toHaveCount(2);
  await page.getByText('Scan & photo correction', { exact: true }).click();
  await page.getByLabel('Rotate clockwise').selectOption('90');
  await page.getByText('Crop & perspective corners (%)', { exact: true }).click();
  for (const [corner, value] of Object.entries({ '0x': 10, '0y': 10, '1x': 90, '1y': 10, '2x': 90, '2y': 90, '3x': 10, '3y': 90 })) {
    await page.locator(`[data-corner="${corner}"]`).fill(String(value));
  }
  await page.getByRole('button', { name: 'Review & apply correction' }).click();
  await expect(page.locator('[data-scan-status]')).toContainText('Correction applied');
  await expect(page.getByRole('img', { name: 'Corrected scan preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Move photo-1.png down', exact: true }).click();
  await page.getByLabel('Photo to correct').selectOption({ label: '2. photo-1.png' });
  await expect(page.getByLabel('Rotate clockwise')).toHaveValue('90');
  await page.getByLabel('Page size').selectOption('original');
  await page.getByLabel('Margin (pt)', { exact: true }).fill('0');

  await page.evaluate(() => {
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
      if (this.width === 480 && this.height === 800) {
        (window as Window & { releasePhotoEncoder?: () => void }).releasePhotoEncoder = () => {
          HTMLCanvasElement.prototype.toBlob = encode;
          encode.call(this, callback, type, quality);
        };
      } else encode.call(this, callback, type, quality);
    };
  });
  await page.locator('[data-run]').click();
  await expect.poll(() => page.evaluate(() => typeof (window as Window & { releasePhotoEncoder?: () => void }).releasePhotoEncoder)).toBe('function');
  await page.getByRole('button', { name: 'Cancel processing' }).click();
  await page.evaluate(() => (window as Window & { releasePhotoEncoder?: () => void }).releasePhotoEncoder!());
  await expect(page.locator('[data-run-status]')).toContainText('Cancelled');
  await expect(page.locator('.df2-output')).toHaveCount(0);

  await page.locator('[data-run]').click();
  await expect(page.locator('.df2-result')).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.locator('.df2-output').click();
  const path = await (await downloaded).path();
  if (!path) throw Error('Missing corrected PDF download');
  const pdf = await PDFDocument.load(await readFile(path));
  expect(pdf.getPages().map(pdfPage => pdfPage.getSize())).toEqual([
    { width: 225, height: 300 }, { width: 360, height: 600 }
  ]);
  await page.getByText('Use PDF in another tool', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Next tool' }).selectOption('rotate');
  await page.getByRole('button', { name: 'Open selected PDF' }).click();
  await expect(page).toHaveURL(/#\/tools\/rotate\/work$/);
  await page.getByRole('button', { name: /Previous revision/ }).click();
  await expect(page).toHaveURL(/#\/tools\/images-to-pdf\/result$/);
  await page.locator('[data-return-edit]').click();
  await page.getByLabel('Photo to correct').selectOption({ label: '2. photo-1.png' });
  await expect(page.getByLabel('Rotate clockwise')).toHaveValue('90');
  await page.getByRole('button', { name: 'Reset this photo' }).click();
  await expect(page.getByLabel('Rotate clockwise')).toHaveValue('0');
  await expect(page.locator('[data-scan-status]')).toContainText('Export uses this original image');
});

test('changing photo settings during phone preview discards the stale correction', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base+'#/tools/images-to-pdf');
  await page.locator('[data-file-input]').setInputFiles({
    name: 'scan.png', mimeType: 'image/png', buffer: await readFile('tests/fixtures/ocr-corpus/eng-sans.png')
  });
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.getByText('Scan & photo correction', { exact: true }).click();
  const rotation = page.getByLabel('Rotate clockwise');
  await rotation.selectOption('90');
  await page.evaluate(() => {
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
      if (this.width > this.height) {
        const signals = window as Window & { releaseStaleReview?: () => void; staleReviewFinished?: boolean };
        signals.releaseStaleReview = () => {
          HTMLCanvasElement.prototype.toBlob = encode;
          encode.call(this, value => { callback(value); setTimeout(() => { signals.staleReviewFinished = true; }, 0); }, type, quality);
        };
      } else encode.call(this, callback, type, quality);
    };
  });
  await page.getByRole('button', { name: 'Review & apply correction' }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as Window & { releaseStaleReview?: () => void }).releaseStaleReview)).toBe('function');
  await rotation.selectOption('180');
  await page.evaluate(() => (window as Window & { releaseStaleReview?: () => void }).releaseStaleReview!());
  await expect.poll(() => page.evaluate(() => (window as Window & { staleReviewFinished?: boolean }).staleReviewFinished)).toBe(true);
  await expect(page.locator('[data-scan-status]')).toContainText('Review and apply the changes');
  await expect(page.getByRole('img', { name: 'Corrected scan preview' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Review & apply correction' }).click();
  await expect(page.getByRole('img', { name: 'Corrected scan preview' })).toBeVisible();
  const audit = await new AxeBuilder({ page }).include('[data-scan-review]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  expect(audit.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) }))).toEqual([]);
});
