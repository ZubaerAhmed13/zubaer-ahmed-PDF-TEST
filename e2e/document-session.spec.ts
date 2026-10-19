import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFile } from 'node:fs/promises';
import { tools } from '../src/tools/registry';
import { redactionCorpus } from '../tests/fixtures/pdfCorpus';

test.use({ actionTimeout: 12_000 });
const appPath = '/zubaer-ahmed-PDF-TEST/';

async function fixture(label = 'SOURCE'): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([320, 440]).drawText(label + ' FIRST PAGE', { x: 30, y: 380, size: 14 });
  doc.addPage([440, 320]).drawText(label + ' SECOND PAGE', { x: 30, y: 260, size: 14 });
  return Buffer.from(await doc.save());
}
async function begin(page: Page, bytes = fixture()): Promise<void> {
  await page.goto(appPath);
  await page.getByRole('button', { name: 'Open a PDF', exact: true }).click();
  await page.locator('#workspace-file').setInputFiles({ name: 'same.pdf', mimeType: 'application/pdf', buffer: await bytes });
  await expect(page.locator('#stage')).toHaveText('Preview ready');
}
async function next(page: Page, id: string): Promise<void> {
  await page.getByRole('combobox', { name: 'Next tool', exact: true }).selectOption(id);
  await expect(page.getByRole('region', { name: 'Workspace', exact: true }).getByRole('heading', { name: tools.find(tool => tool.id === id)!.name, exact: true })).toBeVisible();
  if ((page.viewportSize()?.width ?? 1280) <= 760) await page.locator('[data-mobile-panel="options"]').click();
}
async function apply(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Use result', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Use result', exact: true }).click();
  await expect(page.getByText('Result ready · not yet applied', { exact: true })).toHaveCount(0);
}
async function exportCurrent(page: Page): Promise<Buffer> {
  const downloading = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export current PDF', exact: true }).click();
  const download = await downloading; const path = await download.path();
  if (!path) throw Error('No downloaded PDF was available.');
  return readFile(path);
}
async function text(bytes: Buffer, number = 1): Promise<string> {
  const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
  try { return (await (await pdf.getPage(number)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' '); }
  finally { await pdf.destroy(); }
}

test('one import supports organize → annotate → number → export and exact revision undo/redo', async ({ page }) => {
  test.setTimeout(180_000);
  await begin(page);
  await next(page, 'organize');
  await expect(page.locator('[data-organizer-ready]')).toHaveAttribute('data-organizer-ready', 'true');
  await page.locator('input[name="order"]').fill('2,1');
  await page.getByRole('button', { name: 'Run Organize pages', exact: true }).click();
  await apply(page);
  await next(page, 'annotate');
  await page.locator('textarea[name="text"]').fill('RELEASE SESSION NOTE');
  await page.locator('input[name="markWidth"]').fill('70');
  await page.getByRole('button', { name: 'Run Annotate PDF', exact: true }).click();
  await apply(page);
  await next(page, 'page-numbers');
  await page.locator('input[name="start"]').fill('7');
  await page.locator('select[name="format"]').selectOption('page');
  await page.getByRole('button', { name: 'Run Add page numbers', exact: true }).click();
  await apply(page);
  await page.getByRole('textbox', { name: 'Export filename', exact: true }).fill('finished-session');
  const final = await exportCurrent(page);
  expect((await PDFDocument.load(final)).getPage(0).getWidth()).toBe(440);
  expect(await text(final)).toContain('SOURCE SECOND PAGE');
  expect(await text(final)).toContain('RELEASE SESSION NOTE');
  expect(await text(final)).toContain('Page 7');
  await page.getByRole('button', { name: 'Undo revision', exact: true }).click();
  expect(await text(await exportCurrent(page))).not.toContain('Page 7');
  await page.getByRole('button', { name: 'Redo revision', exact: true }).click();
  expect(await exportCurrent(page)).toEqual(final);
  await page.getByRole('button', { name: 'View original', exact: true }).click();
  await expect(page.locator('.session-identity')).toContainText('Viewing original');
  expect(await exportCurrent(page)).toEqual(final);
  await page.getByRole('button', { name: 'Back to all tools', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume document', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume document', exact: true }).click();
  expect(await exportCurrent(page)).toEqual(final);
});

test('same-named sources merge once each and the selected split result becomes the working copy', async ({ page }) => {
  test.setTimeout(120_000);
  await begin(page, fixture('ALPHA'));
  await next(page, 'merge');
  await page.locator('#workspace-file').setInputFiles({ name: 'same.pdf', mimeType: 'application/pdf', buffer: await fixture('BETA') });
  await expect(page.locator('#file-list .file-row')).toHaveCount(2);
  // Tool switches must release the previous adapter's source list.
  await page.locator('#file-list .file-row').nth(1).locator('[data-parity-move="-1"]').click();
  await expect(page.locator('#file-list .file-row')).toHaveCount(2);
  await page.locator('#file-list .file-row').first().locator('[data-parity-move="1"]').click();
  await expect(page.locator('#file-list .file-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Run Merge PDF', exact: true }).click();
  await apply(page);
  const merged = await exportCurrent(page);
  expect((await PDFDocument.load(merged)).getPageCount()).toBe(4);
  expect(await text(merged, 1)).toContain('ALPHA'); expect(await text(merged, 3)).toContain('BETA');
  await next(page, 'split');
  await page.locator('input[name="ranges"]').fill('1-2;3-4');
  await page.getByRole('button', { name: 'Run Split PDF', exact: true }).click();
  await page.getByRole('combobox', { name: 'Choose PDF result', exact: true }).selectOption('1');
  await apply(page);
  const selected = await exportCurrent(page);
  expect((await PDFDocument.load(selected)).getPageCount()).toBe(2); expect(await text(selected)).toContain('BETA');
});

test('unapplied edits require an explicit leave choice and the narrow session shell is accessible', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await begin(page);
  await next(page, 'annotate');
  await page.locator('textarea[name="text"]').fill('UNAPPLIED PRIVATE NOTE');
  await page.getByRole('combobox', { name: 'Next tool', exact: true }).selectOption('rotate');
  const confirmation = page.getByRole('dialog', { name: 'Leave unapplied tool changes?', exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Keep working', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Workspace', exact: true }).getByRole('heading', { name: 'Annotate PDF', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Next tool', exact: true })).toHaveValue('annotate');
  await expect(page.locator('textarea[name="text"]')).toHaveValue('UNAPPLIED PRIVATE NOTE');
  const issues = await new AxeBuilder({ page }).analyze();
  await testInfo.attach('workspace-accessibility', { body: JSON.stringify(issues.violations, null, 2), contentType: 'application/json' });
  expect(issues.violations.filter(item => ['serious', 'critical'].includes(item.impact ?? '')).map(item => item.id)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.getByRole('combobox', { name: 'Next tool', exact: true }).selectOption('rotate');
  await confirmation.getByRole('button', { name: 'Leave tool', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Workspace', exact: true }).getByRole('heading', { name: 'Rotate pages', exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.stringify(localStorage));
  expect(saved).not.toContain('UNAPPLIED PRIVATE NOTE');
});

test('closing active redaction offers keep/stop and cannot stage late partial output', async ({ page }) => {
  test.setTimeout(120_000);
  await begin(page, redactionCorpus());
  await next(page, 'redact-secure');
  await expect(page.locator('#pro-page-status')).toContainText('Page 1 of 4');
  await page.getByRole('button', { name: 'Add area using coordinates', exact: true }).click();
  await page.locator('#pro-confirm').check();
  await page.evaluate(() => {
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      document.documentElement.dataset.r1Encoding = 'pending';
      document.addEventListener('r1-continue-encoding', () => encode.call(this, callback, type, quality), { once: true });
    };
  });
  await page.getByRole('button', { name: 'Apply permanent redactions', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-r1-encoding', 'pending');
  await page.getByRole('button', { name: 'Back to all tools', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Stop processing?', exact: true });
  await confirmation.getByRole('button', { name: 'Keep working', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Workspace', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to all tools', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Stop and leave', exact: true }).click();
  await page.evaluate(() => document.dispatchEvent(new Event('r1-continue-encoding')));
  await page.getByRole('button', { name: 'Resume document', exact: true }).click();
  await expect(page.getByText('Result ready · not yet applied', { exact: true })).toHaveCount(0);
  const current = await exportCurrent(page);
  expect((await PDFDocument.load(current)).getPageCount()).toBe(4);
});

test('applied redaction clears previous revisions and source preview', async ({ page }) => {
  test.setTimeout(120_000);
  await begin(page, redactionCorpus());
  await next(page, 'redact-secure');
  await expect(page.locator('#pro-page-status')).toContainText('Page 1 of 4');
  await page.getByRole('button', { name: 'Add area using coordinates', exact: true }).click();
  await page.locator('#pro-confirm').check();
  await page.getByRole('button', { name: 'Apply permanent redactions', exact: true }).click();
  const use = page.getByRole('button', { name: 'Use redacted result and clear history', exact: true });
  await expect(use).toBeEnabled(); await use.click();
  await expect(page.getByRole('button', { name: 'Undo revision', exact: true })).toBeDisabled();
  expect(await text(await exportCurrent(page))).toBe('');
  await page.getByRole('button', { name: 'View original', exact: true }).click();
  await expect(page.locator('.session-identity')).toContainText('Viewing original');
  expect(await text(await exportCurrent(page))).toBe('');
});

test('result validation keeps the workspace open until its atomic revision commit completes', async ({ page }) => {
  test.setTimeout(90_000);
  await begin(page);
  await next(page, 'rotate');
  await page.getByRole('button', { name: 'Run Rotate pages', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Use result', exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer;
    let intercepted = false;
    File.prototype.arrayBuffer = function () {
      if (this.name !== 'rotated.pdf' || intercepted) return read.call(this);
      intercepted = true;
      document.documentElement.dataset.r1Validation = 'pending';
      return new Promise<ArrayBuffer>((resolve, reject) => {
        document.addEventListener('r1-complete-validation', () => { void read.call(this).then(resolve, reject); }, { once: true });
      });
    };
  });
  await page.getByRole('button', { name: 'Use result', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-r1-validation', 'pending');
  await page.getByRole('button', { name: 'Back to all tools', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Workspace', exact: true })).toBeVisible();
  await expect(page.locator('.session-notice')).toContainText('Please wait before leaving');
  await expect(page.getByRole('dialog', { name: 'Stop processing?', exact: true })).toHaveCount(0);
  await page.evaluate(() => document.dispatchEvent(new Event('r1-complete-validation')));
  await expect(page.getByText('Result ready · not yet applied', { exact: true })).toHaveCount(0);
  await expect(page.locator('.session-notice')).not.toContainText('Please wait before leaving');
  await page.getByRole('button', { name: 'Back to all tools', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Workspace', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Resume document', exact: true }).click();
  const result = await PDFDocument.load(await exportCurrent(page));
  expect(result.getPage(0).getRotation().angle).toBe(90);
});

test('real service-worker coordination blocks another tab with a document and allows activation after it closes', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Live multi-tab service-worker protocol is certified here in Chromium; state decisions also have runtime tests.');
  test.setTimeout(90_000);
  await page.goto(appPath);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })); });
  const other = await context.newPage(); await begin(other);
  await expect(page.getByRole('button', { name: 'Resume document', exact: true })).toHaveCount(0);
  const check = (): Promise<string> => page.evaluate(() => new Promise<string>(resolve => {
    const listener = (event: MessageEvent): void => {
      if (!['DOCFLOW_UPDATE_BLOCKED', 'DOCFLOW_UPDATE_ACCEPTED'].includes(event.data?.type)) return;
      navigator.serviceWorker.removeEventListener('message', listener); resolve(event.data.type);
    };
    navigator.serviceWorker.addEventListener('message', listener);
    navigator.serviceWorker.controller!.postMessage({ type: 'SKIP_WAITING' });
  }));
  expect(await check()).toBe('DOCFLOW_UPDATE_BLOCKED');
  await expect(other.getByRole('link', { name: 'Export current PDF', exact: true })).toBeVisible();
  await other.close();
  expect(await check()).toBe('DOCFLOW_UPDATE_ACCEPTED');
});
