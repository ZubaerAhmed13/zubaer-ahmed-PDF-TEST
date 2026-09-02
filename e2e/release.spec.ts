import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

const appPath = '/zubaer-ahmed-PDF-TEST/';

async function pdfFixture(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) doc.addPage([300 + index, 400 + index]);
  return Buffer.from(await doc.save());
}

async function formFixture(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 500]);
  const form = doc.getForm();
  const text = form.createTextField('CustomerName');
  text.setText('Existing');
  text.addToPage(page, { x: 40, y: 400, width: 180, height: 24 });
  const checkbox = form.createCheckBox('Accepted');
  checkbox.addToPage(page, { x: 40, y: 350, width: 20, height: 20 });
  return Buffer.from(await doc.save());
}

async function openTool(page: Page, query: string): Promise<Locator> {
  await page.getByLabel('Search tools').fill(query);
  await page.getByRole('button', { name: 'Open tool' }).click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function downloadFrom(dialog: Locator, page: Page, name: RegExp): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('link', { name }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error('Playwright did not expose a download path.');
  return readFile(path);
}

async function runPdfExport(
  page: Page,
  query: string,
  toolName: string,
  outputName: RegExp,
  input: Buffer,
  configure?: (dialog: Locator) => Promise<void>
): Promise<Buffer> {
  const dialog = await openTool(page, query);
  await dialog.locator('#workspace-file').setInputFiles({ name: 'fixture.pdf', mimeType: 'application/pdf', buffer: input });
  if (configure) await configure(dialog);
  await dialog.getByRole('button', { name: `Run ${toolName}` }).click();
  await expect(dialog.locator('#stage')).toHaveText('Complete');
  const bytes = await downloadFrom(dialog, page, outputName);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  return bytes;
}

test.beforeEach(async ({ page }) => {
  await page.goto(appPath);
  await expect(page.getByRole('heading', { name: /Private PDF tools/ })).toBeVisible();
});

test('release matrix reopens structural edit exports', async ({ page }) => {
  const input = await pdfFixture(3);

  const rotatedBytes = await runPdfExport(page, 'rotate', 'Rotate pages', /^Download rotated\.pdf/, input, async (dialog) => {
    await dialog.locator('select[name="degrees"]').selectOption('90');
  });
  const rotated = await PDFDocument.load(rotatedBytes);
  expect(rotated.getPageCount()).toBe(3);
  expect(rotated.getPages().every((pdfPage) => pdfPage.getRotation().angle === 90)).toBe(true);

  const organizedBytes = await runPdfExport(page, 'organize', 'Organize pages', /^Download organized\.pdf/, input, async (dialog) => {
    await dialog.locator('input[name="order"]').fill('3,1,1');
  });
  const organized = await PDFDocument.load(organizedBytes);
  expect(organized.getPages().map((pdfPage) => pdfPage.getWidth())).toEqual([302, 300, 300]);

  const numberedBytes = await runPdfExport(page, 'page numbers', 'Add page numbers', /^Download numbered\.pdf/, input);
  expect((await PDFDocument.load(numberedBytes)).getPageCount()).toBe(3);

  const watermarkedBytes = await runPdfExport(page, 'watermark', 'Add watermark', /^Download watermarked\.pdf/, input, async (dialog) => {
    await dialog.locator('input[name="text"]').fill('RELEASE TEST');
  });
  expect((await PDFDocument.load(watermarkedBytes)).getPageCount()).toBe(3);

  const optimizedBytes = await runPdfExport(page, 'optimize', 'Optimize PDF', /^Download optimized\.pdf/, input);
  expect((await PDFDocument.load(optimizedBytes)).getPageCount()).toBe(3);
});

test('AcroForm inspect, fill, export, and reopen works through the UI', async ({ page }) => {
  const dialog = await openTool(page, 'acroform');
  await dialog.locator('#workspace-file').setInputFiles({ name: 'form.pdf', mimeType: 'application/pdf', buffer: await formFixture() });
  await dialog.getByRole('button', { name: 'Inspect form fields' }).click();
  await expect(dialog.locator('#form-field-summary')).toContainText('2 supported field(s)');
  await dialog.locator('textarea[name="values"]').fill(JSON.stringify({ CustomerName: 'Zubaer', Accepted: true }));
  await dialog.getByRole('button', { name: 'Run Fill PDF forms' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Complete');

  const bytes = await downloadFrom(dialog, page, /^Download filled-form\.pdf/);
  const output = await PDFDocument.load(bytes);
  const form = output.getForm();
  expect(form.getTextField('CustomerName').getText()).toBe('Zubaer');
  expect(form.getCheckBox('Accepted').isChecked()).toBe(true);
});

test('image conversion workflows produce valid downloadable artifacts', async ({ page }) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlRYpkAAAAASUVORK5CYII=', 'base64');
  let dialog = await openTool(page, 'images to pdf');
  await dialog.locator('#workspace-file').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: png });
  await dialog.getByRole('button', { name: 'Run Images to PDF' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Complete');
  const pdfBytes = await downloadFrom(dialog, page, /^Download images\.pdf/);
  expect((await PDFDocument.load(pdfBytes)).getPageCount()).toBe(1);
  await page.keyboard.press('Escape');

  dialog = await openTool(page, 'pdf to images');
  await dialog.locator('#workspace-file').setInputFiles({ name: 'one-page.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(1) });
  await dialog.locator('select[name="format"]').selectOption('png');
  await dialog.getByRole('button', { name: 'Run PDF to images' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Complete');
  const zipBytes = await downloadFrom(dialog, page, /^Download pdf-images\.zip/);
  const zip = await JSZip.loadAsync(zipBytes);
  const imageNames = Object.keys(zip.files).filter((name) => name.endsWith('.png'));
  expect(imageNames).toHaveLength(1);
  const image = await zip.file(imageNames[0]!)!.async('uint8array');
  expect([...image.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
});

test('core PDF processing makes no cross-origin network requests', async ({ page }) => {
  const externalRequests: string[] = [];
  const origin = new URL(page.url()).origin;
  page.on('request', (request) => {
    const url = request.url();
    if (/^https?:/i.test(url) && new URL(url).origin !== origin) externalRequests.push(url);
  });

  const dialog = await openTool(page, 'merge');
  await dialog.locator('#workspace-file').setInputFiles([
    { name: 'one.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(1) },
    { name: 'two.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(2) }
  ]);
  await dialog.getByRole('button', { name: 'Run Merge PDF' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Complete');
  expect(externalRequests).toEqual([]);
});

test('homepage has no serious or critical automated accessibility violations', async ({ page }) => {
  const result = await new AxeBuilder({ page }).analyze();
  const severe = result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(severe, JSON.stringify(severe, null, 2)).toEqual([]);
});
