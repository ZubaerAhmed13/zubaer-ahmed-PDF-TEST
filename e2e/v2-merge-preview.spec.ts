import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function source(name: string, widths: number[]) {
  const pdf = await PDFDocument.create();
  for (const width of widths) pdf.addPage([width, 500]);
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
}

test('phone merge previews each source and preserves the selected PDF through list changes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/zubaer-ahmed-PDF-TEST/#/tools/merge');
  await page.locator('[data-file-input]').setInputFiles([
    await source('report.pdf', [310, 320]),
    await source('report.pdf', [410, 420, 430]),
  ]);
  const files = page.locator('.df2-file');
  const previews = page.getByRole('button', { name: /^Preview report\.pdf/ });
  const indicator = page.locator('[data-page-label]');
  await expect(indicator).toHaveText('Page 1 / 2');
  await expect(previews).toHaveCount(2);
  await previews.nth(1).press('Enter');
  await expect(previews.nth(1)).toBeFocused();
  await expect(previews.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(indicator).toHaveText('Page 1 / 3');
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(indicator).toHaveText('Page 2 / 3');

  await files.nth(1).getByRole('button', { name: 'Move report.pdf up' }).click();
  await expect(previews.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(indicator).toHaveText('Page 2 / 3');
  await page.locator('[data-add-file]').setInputFiles(await source('appendix.pdf', [510]));
  await expect(files).toHaveCount(3);
  await expect(indicator).toHaveText('Page 2 / 3');
  await page.getByRole('button', { name: 'Preview appendix.pdf, document 3', exact: true }).click();
  await expect(indicator).toHaveText('Page 1 / 1');
  await page.getByRole('button', { name: 'Remove appendix.pdf' }).click();
  await expect(indicator).toHaveText('Page 1 / 2');
  await expect(previews.nth(1)).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

  await page.locator('[data-run]').click();
  const pending = page.waitForEvent('download');
  await page.locator('.df2-output').click();
  const path = await (await pending).path();
  if (!path) throw Error('Missing merged PDF');
  const output = await PDFDocument.load(await readFile(path));
  expect(output.getPages().map(p => p.getWidth())).toEqual([410, 420, 430, 310, 320]);
});
