import { returnToEditor } from './helpers/editorReturn';
import { test, expect, type Page, type Locator } from '@playwright/test';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
const app = '/zubaer-ahmed-PDF-TEST/';
async function open(page: Page, id: string, search: string) {
  await page.goto(app); await page.getByLabel('Search tools').fill(search); await page.locator(`#tool-grid [data-open-tool="${id}"]`).click();
  return page.getByRole('region', { name: 'Workspace' });
}
async function pdfTexts(texts: string[]) { const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); for (const text of texts) doc.addPage([480, 600]).drawText(text, { x: 30, y: 500, size: 25, font }); return Buffer.from(await doc.save()); }
async function download(page: Page, dialog: Locator, name: RegExp) { await returnToEditor(page); const pending = page.waitForEvent('download'); await dialog.getByRole('link', { name }).click(); const path = await (await pending).path(); if (!path) throw Error('Missing download'); return readFile(path); }

test('R4 aligns inserted/moved pages and navigates word changes and a safe report', async ({ page }) => {
  const dialog = await open(page, 'compare', 'compare');
  await dialog.getByLabel('Source files', { exact: true }).setInputFiles([
    { name: 'before.pdf', mimeType: 'application/pdf', buffer: await pdfTexts(['Alpha contract total 100 euros', 'Beta delivery tomorrow', 'Gamma final terms']) },
    { name: 'after.pdf', mimeType: 'application/pdf', buffer: await pdfTexts(['New cover', 'Gamma final terms', 'Alpha contract total 120 euros', 'Beta delivery tomorrow']) }
  ]);
  await dialog.getByRole('button', { name: 'Run Compare PDFs' }).click(); await expect(dialog.locator('#stage')).toHaveText('Comparison complete');
  const results = dialog.locator('#pdf-comparison-results');
  await expect(results).toContainText('missing-left'); await expect(results).toContainText('moved');
  await results.getByLabel('Matched pages', { exact: true }).selectOption({ label: 'A 1 ↔ B 3: different' });
  await expect(results.locator('ins')).toHaveText('120 '); await expect(results.locator('del')).toHaveText('100 '); await expect(results.locator('img')).toHaveCount(4);
  const report = (await download(page, dialog, /^Download navigable HTML report/)).toString();
  expect(report).toContain('A 1 ↔ B 3'); expect(report).toContain('<ins>120</ins>'); expect(report).toContain('href="#pair-');
  const violations = (await new AxeBuilder({ page }).include('#workspace-dialog').analyze()).violations.filter(v => v.impact === 'critical' || v.impact === 'serious'); expect(violations).toEqual([]);
});

test('R4 photo crop, perspective review, rotate and reorder export a reopenable PDF', async ({ page }) => {
  const dialog = await open(page, 'images-to-pdf', 'images to PDF');
  const photos = await page.evaluate(() => [[1000, 600, '#c05030'], [300, 400, '#3070b0']].map(([w, h, color]) => { const canvas = document.createElement('canvas'); canvas.width = Number(w); canvas.height = Number(h); const ctx = canvas.getContext('2d')!; ctx.fillStyle = String(color); ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = 'white'; ctx.fillRect(100, 100, 80, 60); return canvas.toDataURL('image/png').split(',')[1]!; }));
  await dialog.getByLabel('Source files', { exact: true }).setInputFiles(photos.map((data, i) => ({ name: `photo-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })));
  await expect(dialog.getByLabel('Take a photo', { exact: true })).toHaveAttribute('capture', 'environment');
  await dialog.locator('select[name=rotation]').selectOption('90');
  await dialog.getByText('Crop & perspective corners (%)', { exact: true }).click();
  for (const [corner, value] of Object.entries({ '0x': 10, '0y': 10, '1x': 90, '1y': 10, '2x': 90, '2y': 90, '3x': 10, '3y': 90 })) await dialog.locator(`[data-corner="${corner}"]`).fill(String(value));
  await dialog.getByRole('button', { name: 'Review & apply correction' }).click(); await expect(dialog.locator('[data-scan-status]')).toContainText('Correction applied');
  await expect(dialog.locator('[data-scan-preview] img')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Move photo-1.png down', exact: true }).click();
  await dialog.locator('select[name=pageSize]').selectOption('original'); await dialog.locator('input[name=margin]').fill('0');
  // Hold the final PNG encoder to reproduce cancellation between correction and PDF conversion.
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
      if (this.width === 480 && this.height === 800) {
        const encode = original.bind(this);
        (window as Window & { releaseR4Encoder?: () => void }).releaseR4Encoder = () => { HTMLCanvasElement.prototype.toBlob = original; encode(callback, type, quality); };
      } else original.call(this, callback, type, quality);
    };
  });
  await dialog.getByRole('button', { name: 'Run Images to PDF' }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as Window & { releaseR4Encoder?: () => void }).releaseR4Encoder)).toBe('function');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => (window as Window & { releaseR4Encoder?: () => void }).releaseR4Encoder!());
  await expect(dialog.locator('#stage')).toHaveText('Cancelled'); await expect(dialog.locator('#result a.download')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Run Images to PDF' }).click(); await expect(dialog.locator('#stage')).toHaveText('Complete');
  await returnToEditor(page);
  const bytes = await download(page, dialog, /^Download images\.pdf/), pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBe(2); expect(pdf.getPage(0).getSize()).toEqual({ width: 225, height: 300 }); expect(pdf.getPage(1).getWidth()).toBeCloseTo(360, 0); expect(pdf.getPage(1).getHeight()).toBeCloseTo(600, 0);
});

test('R4 selected rotated/CropBox scan supports mixed-language Unicode OCR with before/after review', async ({ page }) => {
  test.setTimeout(150_000);
  const doc = await PDFDocument.create(), png = await doc.embedPng(await readFile('tests/fixtures/ocr-corpus/mixed-sans.png'));
  doc.addPage([500, 500]); const target = doc.addPage([760, 430]); target.drawImage(png, { x: 35, y: 55, width: 700, height: 350 }); target.setCropBox(35, 55, 700, 350); target.setRotation(degrees(90)); doc.addPage([500, 500]); const source = Buffer.from(await doc.save());
  const dialog = await open(page, 'ocr', 'OCR'); const external: string[] = [], origin = new URL(page.url()).origin; page.on('request', r => { if (r.url().startsWith('http') && new URL(r.url()).origin !== origin) external.push(r.url()); });
  await dialog.getByLabel('Source files', { exact: true }).setInputFiles({ name: 'rotated-crop.pdf', mimeType: 'application/pdf', buffer: source });
  await dialog.locator('input[name=pages]').fill('2'); await dialog.locator('input[name=maxPages]').fill('1'); await dialog.locator('select[name=language]').selectOption('eng+deu');
  await dialog.getByText('Rotation, deskew & cleanup review', { exact: true }).click(); await dialog.locator('select[name=rotation]').selectOption('270'); await dialog.locator('input[name=previewPage]').fill('2');
  await dialog.getByRole('button', { name: 'Review before / after' }).click(); await expect(dialog.locator('[data-ocr-preview-status]')).toContainText('Review ready'); await expect(dialog.locator('[data-ocr-preview-pair] img')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Run OCR scanned PDF' }).click(); await expect(dialog.locator('#stage')).toContainText('OCR complete: 1', { timeout: 120_000 });
  await expect(dialog.locator('#result')).toContainText('Unprocessed pages preserved unchanged: 1, 3');
  const bytes = await download(page, dialog, /^Download searchable-ocr\.pdf/), output = await PDFDocument.load(bytes); expect(output.getPageCount()).toBe(3); expect(output.getPage(1).getCropBox()).toEqual(target.getCropBox()); expect(output.getPage(1).getRotation().angle).toBe(90);
  const recognized = (await download(page, dialog, /^Download ocr-recognized-text\.txt/)).toString();
  const recognizedWord = recognized.match(/pr[üu]fen/iu)?.[0]; expect(recognizedWord).toBeTruthy(); expect(recognized).toContain('Grüße');
  const view = await getDocument({ data: new Uint8Array(bytes) }).promise;
  try { const text = (await (await view.getPage(2)).getTextContent()).items.map(i => 'str' in i ? i.str : '').join(' '); expect(text).toContain('Grüße'); expect(text).toContain(recognizedWord!); expect((await (await view.getPage(1)).getTextContent()).items).toHaveLength(0); } finally { await view.destroy(); }
  expect(external).toEqual([]);
});

test('R4 incomplete comparison and literal Markdown extraction remain explicit', async ({ page }) => {
  const dialog = await open(page, 'compare', 'compare'); await dialog.getByLabel('Source files', { exact: true }).setInputFiles([
    { name: 'a.pdf', mimeType: 'application/pdf', buffer: await pdfTexts(['Alpha', 'Beta']) }, { name: 'b.pdf', mimeType: 'application/pdf', buffer: await pdfTexts(['Alpha', 'Beta']) }
  ]);
  await dialog.locator('input[name=maxPages]').fill('1'); await dialog.getByRole('button', { name: 'Run Compare PDFs' }).click(); await expect(dialog.locator('#stage')).toHaveText('Comparison complete'); await expect(dialog.locator('#pdf-comparison-results')).toContainText('Incomplete comparison');
  page.on('dialog', d => d.accept()); await page.goto(app); const extraction = await open(page, 'text-search', 'extract text'); await extraction.getByLabel('Source files', { exact: true }).setInputFiles({ name: 'literal.pdf', mimeType: 'application/pdf', buffer: await pdfTexts(['# title <script> [link](x)', 'Second page']) });
  await extraction.getByRole('button', { name: /Run Search/ }).click(); await expect(extraction.locator('#stage')).toHaveText('Complete'); const markdown = (await download(page, extraction, /^Download extracted-text\.md/)).toString(); expect(markdown).toContain('\\# title \\<script\\>'); expect(markdown).toContain('## Page 2');
  await returnToEditor(page);
});
