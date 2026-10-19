import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import AxeBuilder from '@axe-core/playwright';
import { tools } from '../src/tools/registry';
import JSZip from 'jszip';

const base = '/zubaer-ahmed-PDF-TEST/';
async function sample(count = 1) {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < count; index++) pdf.addPage([400 + index, 560]).drawText('Page journey original ' + (index + 1), { x: 30, y: 500, font, size: 16 });
  return { name: 'journey.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
}

test('direct tool URL opens a focused page and a real edit exports on a separate result page', async ({ page }) => {
  await page.goto(base + '#/tools/edit-pdf');
  await expect(page.locator('[data-upload-stage]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select PDF file', exact: true })).toBeEnabled();
  await page.screenshot({ path: 'test-results/journey-desktop-upload.png' });
  expect(await page.locator('#workspace-dialog').evaluate(element => element.matches(':modal'))).toBe(false);
  await page.locator('#workspace-file').setInputFiles(await sample());
  await expect(page.locator('[data-upload-stage]')).toBeHidden();
  await expect(page.locator('#run-operation')).toBeEnabled();
  expect((await page.locator('.direct-scroll').boundingBox())!.y).toBeLessThan(500);
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await page.locator('[data-properties] textarea').fill('Journey note');
  await page.getByRole('button', { name: 'Apply properties', exact: true }).click();
  await page.screenshot({ path: 'test-results/journey-desktop-editor.png' });
  await page.locator('#run-operation').click();
  const result = page.locator('[data-result-page]');
  await expect(result).toBeVisible();
  await page.screenshot({ path: 'test-results/journey-desktop-result.png' });
  await expect(page).toHaveURL(/#\/results\/[a-z0-9-]+$/);
  await result.getByRole('textbox', { name: 'Output filename' }).fill('finished.pdf');
  const pending = page.waitForEvent('download');
  await result.getByRole('link', { name: 'Download PDF', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('finished.pdf');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect((await PDFDocument.load(Buffer.concat(chunks))).getPageCount()).toBe(1);
  await result.getByRole('button', { name: 'Return to editing', exact: true }).click();
  await expect(page).toHaveURL(/#\/tools\/edit-pdf$/);
  await expect(page.locator('[data-object]')).toHaveCount(1);
  await expect(page.locator('[data-properties] textarea')).toHaveValue('Journey note');
});

test('browser Back cancellation preserves the tool, file and history entry', async ({ page }) => {
  await page.goto(base);
  await page.locator('[data-tool="edit-pdf"] [data-open-tool]').click();
  await page.locator('#workspace-file').setInputFiles(await sample());
  await expect(page.locator('#run-operation')).toBeEnabled();
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await page.goBack();
  await page.getByRole('dialog', { name: 'Leave unapplied tool changes?' }).getByRole('button', { name: 'Keep working' }).click();
  await expect(page).toHaveURL(/#\/tools\/edit-pdf$/);
  await expect(page.locator('[data-object]')).toHaveCount(1);
  await page.goBack();
  await page.getByRole('dialog', { name: 'Leave unapplied tool changes?' }).getByRole('button', { name: 'Leave tool', exact: true }).click();
  await expect(page.locator('#tool-search')).toBeVisible();
});

test('expired result links provide recovery without a fabricated download', async ({ page }) => {
  await page.goto(base + '#/results/expired-123');
  await expect(page.getByRole('heading', { name: 'This result is no longer available' })).toBeVisible();
  await expect(page.locator('[data-result-page] a[download]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Choose a tool', exact: true }).click();
  await expect(page.locator('#tool-search')).toBeVisible();
});

test('split results retain distinct bytes and safe names on the dedicated download page', async ({ page }) => {
  await page.goto(base);
  await page.getByRole('button', { name: 'Open a PDF', exact: true }).click();
  await page.locator('#workspace-file').setInputFiles(await sample(2));
  await expect(page.locator('#stage')).toContainText('Preview ready');
  await page.getByRole('combobox', { name: 'Next tool', exact: true }).selectOption('split');
  await page.locator('input[name="ranges"]').fill('1;2');
  await page.locator('#run-operation').click();
  const results = page.locator('[data-result-page]');
  await expect(results).toBeVisible();
  const cards = results.locator('.page-output');
  await expect(cards).toHaveCount(2);
  await cards.nth(0).getByRole('textbox', { name: 'Output filename' }).fill('same');
  await cards.nth(1).getByRole('textbox', { name: 'Output filename' }).fill('same');
  await expect(cards.nth(0).getByRole('link', { name: 'Download PDF', exact: true })).toHaveAttribute('download', 'same.pdf');
  await expect(cards.nth(1).getByRole('link', { name: 'Download PDF', exact: true })).toHaveAttribute('download', 'same-2.pdf');
  const pending = page.waitForEvent('download');
  await cards.nth(1).getByRole('link', { name: 'Download PDF', exact: true }).click();
  const download = await pending;
  const stream = await download.createReadStream(), chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect((await PDFDocument.load(Buffer.concat(chunks))).getPage(0).getWidth()).toBe(401);
});

test('every stable tool opens its own page and accepts a direct link', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(base);
  for (const tool of tools) {
    await page.locator(`[data-tool="${tool.id}"] [data-open-tool]`).click();
    await expect(page).toHaveURL(new RegExp('#/tools/' + tool.id + '$'));
    await expect(page.locator('[data-upload-stage] h1')).toHaveText(tool.name);
    await expect(page.locator('[data-select-source]')).toBeEnabled();
    await page.locator('[data-page-home]').first().click();
    await expect(page.locator('#tool-search')).toBeVisible();
  }
});

test('phone discovery, upload and result states fit the screen and remain accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  expect((await page.locator('#tool-search').boundingBox())!.y).toBeLessThan(600);
  await page.screenshot({ path: 'test-results/journey-phone-home.png' });
  await page.locator('[data-tool="rotate"] [data-open-tool]').click();
  await page.locator('#workspace-file').setInputFiles(await sample());
  await page.locator('#run-operation').click();
  await expect(page.locator('[data-result-page]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'test-results/journey-phone-result.png' });
  const audit = await new AxeBuilder({ page }).analyze();
  expect(audit.violations.filter(v => ['critical', 'serious'].includes(v.impact ?? ''))).toEqual([]);
});

for (const tool of ['batch', 'workflow']) test(`${tool} archive can be renamed on its result page without losing the download`, async ({ page }) => {
  await page.goto(base + '#/tools/' + tool);
  await page.locator(tool === 'batch' ? '#batch-files' : '#wf-input').setInputFiles(await sample());
  await page.getByRole('button', { name: tool === 'batch' ? 'Run batch' : 'Run workflow', exact: true }).click();
  const results = page.locator('[data-result-page]');
  await expect(results).toBeVisible();
  await results.getByRole('button', { name: 'Return to editing', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare ZIP', exact: true }).click();
  await expect(results).toBeVisible();
  await results.getByRole('textbox', { name: 'Output filename' }).fill('reviewed-archive');
  const link = results.getByRole('link', { name: 'Download ZIP', exact: true });
  await expect(link).toHaveAttribute('download', 'reviewed-archive.zip');
  const pending = page.waitForEvent('download'); await link.click();
  const download = await pending, stream = await download.createReadStream(), chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const zip = await JSZip.loadAsync(Buffer.concat(chunks));
  const entry = Object.values(zip.files).find(file => !file.dir)!;
  expect((await PDFDocument.load(await entry.async('uint8array'))).getPageCount()).toBe(1);
});

test('phone processing errors remain visible after closing Options', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '#/tools/split');
  await page.locator('#workspace-file').setInputFiles(await sample());
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.locator('input[name="ranges"]').fill('99');
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.locator('#run-operation').click();
  await expect(page.locator('#stage')).toHaveText('Failed');
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#stage')).toBeVisible();
});
