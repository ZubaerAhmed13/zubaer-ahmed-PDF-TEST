import { returnToEditor } from './helpers/editorReturn';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

async function makePdf(name: string, count: number): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < count; i++) {
    const page = document.addPage([595, 842]);
    page.drawText('DocFlow workflow content page ' + (i + 1), { x: 55, y: 700, size: 20, font });
  }
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await document.save()) };
}
async function open(page: Page): Promise<Locator> {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.getByLabel('Search tools').fill('workflow builder');
  await page.locator('#tool-grid [data-open-tool="workflow"]').click();
  const dialog = page.getByRole('region', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Manage workflow recipes', exact: true }).click();
  await expect(dialog.locator('#wf-steps .wf-step')).toHaveCount(2);
  return dialog;
}
async function download(page: Page, link: Locator): Promise<Buffer> {
  await returnToEditor(page);
  const event = page.waitForEvent('download');
  await link.click();
  const item = await event;
  const where = await item.path();
  if (!where) throw Error('Download unavailable');
  return readFile(where);
}

test('chains two local operations on two PDFs with downloads and ZIP', async ({ page }) => {
  const dialog = await open(page);
  await dialog.locator('#wf-input').setInputFiles([
    await makePdf('first.pdf', 2),
    await makePdf('second.pdf', 1)
  ]);
  await dialog.getByRole('button', { name: 'Run workflow' }).click();
  await expect(dialog.locator('#wf-stage')).toContainText('Finished', { timeout: 90_000 });
  await returnToEditor(page);
  await expect(dialog.locator('.batch-row[data-state=complete]')).toHaveCount(2);
  const links = dialog.locator('#wf-results a.download');
  await expect(links).toHaveCount(2);
  const first = await download(page, links.first());
  const parsed = await PDFDocument.load(first);
  expect(parsed.getPageCount()).toBe(2);
  const loading = getDocument({ data: new Uint8Array(first) });
  const document = await loading.promise;
  const text = (await (await document.getPage(1)).getTextContent()).items
    .map(item => 'str' in item ? item.str : '').join(' ');
  await document.destroy();
  expect(text).toContain('DocFlow workflow content page 1');
  expect(text).toMatch(/Page\s*1|1\s*\/\s*2/);

  await dialog.getByRole('button', { name: 'Prepare ZIP' }).click();
  await expect(page.locator('[data-result-page]')).toBeVisible();
  await returnToEditor(page);
  const zipLink = dialog.locator('#wf-results a[download="docflow-workflow-results.zip"]');
  await expect(zipLink).toBeVisible();
  const zip = await download(page, zipLink);
  const JSZip = (await import('jszip')).default;
  const archive = await JSZip.loadAsync(zip);
  const names = Object.keys(archive.files).sort();
  expect(names).toHaveLength(2);
  expect(names[0]).toMatch(/first-1-workflow\.pdf/);
  expect(names[1]).toMatch(/second-2-workflow\.pdf/);
});

test('reorder and save a workflow preset without storing PDF bytes or filenames', async ({ page }) => {
  const dialog = await open(page);
  const steps = dialog.locator('.wf-step');
  await steps.nth(1).getByRole('button', { name: /Move up/ }).click();
  await expect(steps.first().locator('.wf-step-top strong')).toContainText('Optimise PDF');
  await dialog.locator('#wf-name').fill('Quarterly preparation');
  await dialog.getByRole('button', { name: 'Save preset on this device' }).click();
  await expect(dialog.locator('#wf-stage')).toContainText('Preset saved locally');
  const stored = await page.evaluate(() => localStorage.getItem('docflow.workflow-recipes.v1'));
  expect(stored).toContain('Quarterly preparation');
  expect(stored).not.toContain('PDF-BYTES');
  await page.reload();
  await page.locator('[data-configure-workflow]').click();
  const reopened = page.getByRole('region', { name: 'Workspace' });
  await reopened.locator('#wf-recipes').selectOption({ label: 'Quarterly preparation · saved' });
  await reopened.getByRole('button', { name: 'Load recipe' }).click();
  await expect(reopened.locator('.wf-step').first().locator('.wf-step-top strong')).toContainText('Optimise PDF');
  await reopened.getByRole('button', { name: 'Delete saved recipe' }).click();
  expect(await page.evaluate(() => localStorage.getItem('docflow.workflow-recipes.v1'))).not.toContain('Quarterly preparation');
});

test('keeps successful batch results while allowing failed files to retry', async ({ page }) => {
  const dialog = await open(page);
  await dialog.locator('.wf-step').nth(1).getByRole('button', { name: /Remove step/ }).click();
  await dialog.locator('.wf-step').first().getByRole('button', { name: /Remove step/ }).click();
  await dialog.locator('#wf-new-operation').selectOption('remove-pages');
  await dialog.getByRole('button', { name: 'Add step' }).click();
  await dialog.locator('.wf-step input').fill('2');
  await dialog.locator('#wf-input').setInputFiles([
    await makePdf('too-short.pdf', 1),
    await makePdf('valid.pdf', 2)
  ]);
  await dialog.getByRole('button', { name: 'Run workflow' }).click();
  await expect(dialog.locator('#wf-stage')).toContainText('Finished', { timeout: 90_000 });
  await returnToEditor(page);
  await expect(dialog.locator('.batch-row[data-state=failed]')).toHaveCount(1);
  await expect(dialog.locator('.batch-row[data-state=complete]')).toHaveCount(1);
  const completed = dialog.locator('#wf-results a.download');
  await expect(completed).toHaveCount(1);
  expect((await PDFDocument.load(await download(page, completed))).getPageCount()).toBe(1);
  await dialog.getByRole('button', { name: 'Retry failed' }).click();
  await expect(dialog.locator('#wf-stage')).toContainText('Finished', { timeout: 90_000 });
  await returnToEditor(page);
  await expect(dialog.locator('.batch-row[data-state=complete]')).toHaveCount(1);
  await expect(dialog.locator('.batch-row[data-state=failed]')).toHaveCount(1);
  await expect(dialog.locator('#wf-results a.download')).toHaveCount(1);
});

test('mobile step editing and form controls remain accessible', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 780 });
  const dialog = await open(page);
  await dialog.locator('#wf-new-operation').selectOption('watermark');
  await dialog.getByRole('button', { name: 'Add step' }).click();
  await expect(dialog.locator('.wf-step')).toHaveCount(3);
  await expect(dialog.locator('.wf-step').last().getByText('Watermark text')).toBeVisible();
  await dialog.locator('.wf-step').last().getByLabel('Watermark text', { exact: true }).fill('PERSONAL COPY');
  expect(await dialog.locator('.wf-step').last().getByLabel('Watermark text', { exact: true }).inputValue()).toBe('PERSONAL COPY');
  await expect(dialog.getByRole('button', { name: 'Run workflow' })).toBeVisible();
});
