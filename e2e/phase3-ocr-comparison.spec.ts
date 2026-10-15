import { test, expect, type Page, type Locator } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const app = '/zubaer-ahmed-PDF-TEST/';

async function documentWithText(text: string, secondPage = false): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([480, 580]);
  page.drawText(text, { x: 40, y: 460, size: 32, font });
  if (secondPage) {
    const next = doc.addPage([480, 580]);
    next.drawText('Second page', { x: 40, y: 460, size: 22, font });
  }
  return Buffer.from(await doc.save());
}
async function opened(page: Page, id: string, label: string): Promise<Locator> {
  await page.goto(app);
  await page.getByLabel('Search tools').fill(label);
  await page.locator('#tool-grid [data-open-tool="' + id + '"]').click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function downloaded(page: Page, dialog: Locator, filename: RegExp): Promise<Buffer> {
  const pending = page.waitForEvent('download');
  await dialog.getByRole('link', { name: filename }).click();
  const item = await pending;
  const location = await item.path();
  if (!location) throw Error('Download file was not saved.');
  return readFile(location);
}

test('compare two PDFs and report textual and visual changes with a screenshot overlay', async ({ page }) => {
  const dialog = await opened(page, 'compare', 'compare PDFs');
  await dialog.locator('#workspace-file').setInputFiles([
    { name: 'original.pdf', mimeType: 'application/pdf', buffer: await documentWithText('Version Alpha', true) },
    { name: 'revised.pdf', mimeType: 'application/pdf', buffer: await documentWithText('Version Bravo', true) }
  ]);
  await dialog.getByRole('button', { name: 'Run Compare PDFs' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Comparison complete', { timeout: 45_000 });
  const summary = dialog.locator('#pdf-comparison-results');
  await expect(summary).toContainText('1 changed page');
  await expect(summary).toContainText('text changed');
  await expect(summary.locator('img')).toHaveCount(4);
  await expect(summary.locator('input[type=range]')).toBeVisible();
  const report = (await downloaded(page, dialog, /^Download comparison report/)).toString('utf8');
  expect(report).toContain('Page 1: different');
  expect(report).toContain('Page 2: same');
});

test('text-only comparison reports missing pages and transparent page limits', async ({ page }) => {
  const dialog = await opened(page, 'compare', 'compare PDFs');
  await dialog.locator('#workspace-file').setInputFiles([
    { name: 'long.pdf', mimeType: 'application/pdf', buffer: await documentWithText('Same', true) },
    { name: 'short.pdf', mimeType: 'application/pdf', buffer: await documentWithText('Same') }
  ]);
  await dialog.locator('select[name=mode]').selectOption('text');
  await dialog.getByRole('button', { name: 'Run Compare PDFs' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Comparison complete');
  await expect(dialog.locator('#pdf-comparison-results')).toContainText('missing-right');
});

test('OCR keeps already selectable PDF pages without loading any external model', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== new URL(page.url()).origin) external.push(request.url());
  });
  const dialog = await opened(page, 'ocr', 'OCR scanned PDF');
  await dialog.locator('#workspace-file').setInputFiles({ name: 'selectable.pdf', mimeType: 'application/pdf', buffer: await documentWithText('Already searchable') });
  await dialog.getByRole('button', { name: 'Run OCR scanned PDF' }).click();
  await expect(dialog.locator('#stage')).toContainText('OCR complete', { timeout: 45_000 });
  const result = await downloaded(page, dialog, /^Download searchable-ocr\.pdf/);
  expect((await PDFDocument.load(result)).getPageCount()).toBe(1);
  const txt = (await downloaded(page, dialog, /^Download ocr-recognized-text\.txt/)).toString('utf8');
  expect(txt).toContain('Already searchable');
  expect(external).toEqual([]);
});

test('a scanned image becomes searchable through same-origin OCR with visible original preserved', async ({ page }) => {
  test.setTimeout(120_000);
  const scannedImage = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 320;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'white';
    context.fillRect(0, 0, 1000, 320);
    context.fillStyle = 'black';
    context.font = 'bold 92px Arial';
    context.fillText('DOCFLOW OCR TEST', 48, 180);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  const doc = await PDFDocument.create();
  const picture = await doc.embedPng(Buffer.from(scannedImage, 'base64'));
  const imgPage = doc.addPage([500, 160]);
  imgPage.drawImage(picture, { x: 0, y: 0, width: 500, height: 160 });
  const source = Buffer.from(await doc.save());

  const requests: string[] = [];
  const dialog = await opened(page, 'ocr', 'OCR scanned PDF');
  page.on('request', (r) => { if (r.url().startsWith('http')) requests.push(r.url()); });
  await dialog.locator('#workspace-file').setInputFiles({ name: 'scanned.pdf', mimeType: 'application/pdf', buffer: source });
  await dialog.locator('input[name=maxPages]').fill('1');
  await dialog.getByRole('button', { name: 'Run OCR scanned PDF' }).click();
  await expect(dialog.locator('#stage')).toContainText('OCR complete', { timeout: 105_000 });
  const encoded = await downloaded(page, dialog, /^Download searchable-ocr\.pdf/);
  const pdf = await PDFDocument.load(encoded);
  expect(pdf.getPageCount()).toBe(1);
  const original = await PDFDocument.load(source);
  expect(pdf.getPage(0).getSize()).toEqual(original.getPage(0).getSize());
  const loaded = getDocument({ data: new Uint8Array(encoded) });
  const viewer = await loaded.promise;
  const content = await (await viewer.getPage(1)).getTextContent();
  const searchable = content.items.map(item => 'str' in item ? item.str : '').join(' ');
  await viewer.destroy();
  expect(searchable.toUpperCase()).toMatch(/DOCFLOW|OCR/);
  const origin = new URL(page.url()).origin;
  expect(requests.filter(url => new URL(url).origin !== origin)).toEqual([]);
});
