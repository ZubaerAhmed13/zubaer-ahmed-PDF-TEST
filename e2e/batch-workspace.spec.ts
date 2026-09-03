import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function pdfFixture(width: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([width, 500]);
  doc.addPage([width + 1, 501]);
  return Buffer.from(await doc.save());
}

test('batch queue rotates multiple PDFs sequentially and packages reopenable outputs into ZIP', async ({ page }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.getByLabel('Search tools').fill('batch');
  await page.locator('#tool-grid [data-open-tool="batch"]').click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });

  await dialog.locator('#batch-files').setInputFiles([
    { name: 'alpha.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(300) },
    { name: 'beta.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(400) },
    { name: 'gamma.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(500) }
  ]);
  await expect(dialog.locator('.batch-row')).toHaveCount(3);
  await dialog.getByLabel('Batch operation').selectOption('rotate');
  await dialog.locator('select[name="degrees"]').selectOption('90');
  await dialog.getByRole('button', { name: 'Run batch' }).click();

  await expect(dialog.locator('#batch-stage')).toHaveText('Batch complete · 3 of 3 succeeded');
  await expect(dialog.locator('.batch-row[data-state="complete"]')).toHaveCount(3);
  await expect(dialog.getByRole('link', { name: /^Download alpha-rotated\.pdf/ })).toBeVisible();
  await expect(dialog.getByRole('link', { name: /^Download beta-rotated\.pdf/ })).toBeVisible();
  await expect(dialog.getByRole('link', { name: /^Download gamma-rotated\.pdf/ })).toBeVisible();

  await dialog.getByRole('button', { name: 'Prepare ZIP' }).click();
  await expect(dialog.locator('#batch-stage')).toHaveText('ZIP ready · 3 outputs');
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('link', { name: /^Download docflow-batch-results\.zip/ }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error('Playwright did not expose the batch ZIP download path.');

  const zip = await JSZip.loadAsync(await readFile(path));
  for (const name of ['alpha-rotated.pdf', 'beta-rotated.pdf', 'gamma-rotated.pdf']) {
    const entry = zip.file(name);
    expect(entry, `${name} should be present in the batch ZIP`).not.toBeNull();
    const bytes = await entry!.async('uint8array');
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getPageCount()).toBe(2);
    expect(reopened.getPages().map((pdfPage) => pdfPage.getRotation().angle)).toEqual([90, 90]);
  }
});

test('batch queue continues after one malformed PDF and keeps successful outputs available', async ({ page }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.getByLabel('Search tools').fill('batch');
  await page.locator('#tool-grid [data-open-tool="batch"]').click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });

  await dialog.locator('#batch-files').setInputFiles([
    { name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nthis is deliberately malformed') },
    { name: 'valid.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(360) }
  ]);
  await dialog.getByRole('button', { name: 'Run batch' }).click();

  await expect(dialog.locator('#batch-stage')).toHaveText('Batch complete · 1 of 2 succeeded');
  await expect(dialog.locator('.batch-row[data-state="failed"]')).toHaveCount(1);
  await expect(dialog.locator('.batch-row[data-state="complete"]')).toHaveCount(1);
  await expect(dialog.locator('.batch-row[data-state="failed"] .batch-state')).toContainText('INVALID_PDF');
  await expect(dialog.getByRole('link', { name: /^Download valid-rotated\.pdf/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Run batch' })).toBeEnabled();
});

test('batch cancellation stops an active queue and leaves no pending items running', async ({ page }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.getByLabel('Search tools').fill('batch');
  await page.locator('#tool-grid [data-open-tool="batch"]').click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });

  // Use enough sequential worker jobs that the queue remains genuinely active long enough
  // for the cancellation interaction on slower and faster browser engines alike.
  const cancelFiles = await Promise.all(Array.from({ length: 16 }, async (_, index) => ({
    name: `cancel-${String(index + 1).padStart(2, '0')}.pdf`,
    mimeType: 'application/pdf',
    buffer: await pdfFixture(320 + index)
  })));
  await dialog.locator('#batch-files').setInputFiles(cancelFiles);
  await expect(dialog.locator('.batch-row')).toHaveCount(16);
  await dialog.getByRole('button', { name: 'Run batch' }).click();
  const cancel = dialog.getByRole('button', { name: 'Cancel batch' });
  await expect(cancel).toBeEnabled();
  await cancel.click();

  await expect(dialog.locator('#batch-stage')).toContainText('Batch cancelled');
  await expect(dialog.locator('.batch-row[data-state="running"]')).toHaveCount(0);
  await expect(dialog.locator('.batch-row[data-state="pending"]')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Run batch' })).toBeEnabled();
});
