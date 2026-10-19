import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

const home = '/zubaer-ahmed-PDF-TEST/';
async function pages() {
  const pdf = await PDFDocument.create();
  for (let n = 0; n < 4; n++) pdf.addPage([300 + n, 420]);
  return { name: 'visual-pages.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
}
async function load(page: import('@playwright/test').Page, tool: string) {
  await page.goto(home + '#/tools/' + tool);
  await page.locator('#workspace-file').setInputFiles(await pages());
  await expect(page.locator('.df-page-picker')).toHaveAttribute('data-page-picker-ready','true');
  await expect(page.locator('.df-picker-card')).toHaveCount(4);
}
async function downloadPdf(page: import('@playwright/test').Page) {
  await page.locator('#run-operation').click();
  const result = page.locator('[data-result-page]');
  await expect(result).toBeVisible();
  const pending = page.waitForEvent('download');
  await result.getByRole('link', { name:'Download PDF', exact:true }).first().click();
  const dl = await pending;
  const path = await dl.path();
  if (!path) throw new Error('Download path unavailable');
  return PDFDocument.load(await readFile(path));
}

test('visual Remove pages supports range selection and exports the correct remaining PDF pages', async ({ page }) => {
  await load(page, 'remove-pages');
  const cards = page.locator('.df-picker-card');
  await cards.nth(0).locator('[data-pick-select]').click();
  await cards.nth(2).locator('[data-pick-select]').click({ modifiers: ['Shift'] });
  await expect(page.locator('input[name="pages"]')).toHaveValue('1-3');
  await expect(cards.nth(1).locator('[data-pick-select]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-picker-count]')).toHaveText('3 of 4 selected');
  const output = await downloadPdf(page);
  expect(output.getPageCount()).toBe(1);
  expect(output.getPage(0).getWidth()).toBe(303);
});

test('Extract pages reflects manually typed ranges and creates the exact selected PDF', async ({ page }) => {
  await load(page, 'extract-pages');
  const field = page.locator('input[name="pages"]');
  await field.fill('4,2');
  await expect(page.locator('.df-picker-card').nth(1).locator('[data-pick-select]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.df-picker-card').nth(3).locator('[data-pick-select]')).toHaveAttribute('aria-pressed','true');
  await page.locator('.df-picker-card').nth(0).locator('[data-pick-select]').click();
  await expect(field).toHaveValue('1-2,4');
  const output = await downloadPdf(page);
  expect(output.getPageCount()).toBe(3);
  expect(output.getPages().map(page => page.getWidth())).toEqual([300,301,303]);
});

test('all-pages remove is blocked before execution; mobile page preview keeps focus and selected state', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await load(page, 'remove-pages');
  await page.locator('[data-pick-all]').click();
  await expect(page.locator('input[name="pages"]')).toHaveValue('1-4');
  await page.locator('#run-operation').click();
  await expect(page.locator('.df-page-picker [data-picker-alert]')).toContainText('Keep at least one page');
  await expect(page.locator('[data-result-page]')).toBeHidden();
  await page.locator('.df-picker-card').nth(1).locator('[data-pick-select]').click();
  const previewButton = page.getByRole('button',{name:'Preview page 2'});
  await previewButton.click();
  const modal = page.getByRole('dialog',{name:'Page preview'});
  await expect(modal).toBeVisible();
  await expect(modal.locator('[data-picker-preview-status]')).not.toContainText('Rendering page…');
  const pixels = await modal.locator('canvas').evaluate(node => (node as HTMLCanvasElement).width);
  expect(pixels).toBeGreaterThan(80);
  await modal.getByRole('button',{name:'Done'}).click();
  await expect(previewButton).toBeFocused();
  await expect(page.locator('input[name="pages"]')).toHaveValue('1,3-4');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});
