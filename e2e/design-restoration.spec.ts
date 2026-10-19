import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

test('dedicated-page shell keeps DocFlow identity and a generous desktop document workspace', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/zubaer-ahmed-PDF-TEST/');

  await expect(page.locator('.hero-copy')).toBeVisible();
  await expect(page.locator('.hero-art')).toBeHidden();
  await expect(page.getByRole('heading', { name: /Your PDFs/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose an operation' })).toBeVisible();
  await expect(page.locator('#how-it-works')).toBeVisible();
  await expect(page.locator('#privacy-section')).toBeVisible();

  const gridColumns = await page.locator('#tool-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(gridColumns).toBe(4);

  await expect(page.locator('.tool-card').first().locator('.tool-category-label')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Privacy' }).first()).toBeVisible();

  await page.getByLabel('Search tools').fill('merge');
  await expect(page.getByRole('heading', { name: 'Merge PDF' })).toBeVisible();
  await page.getByRole('button', { name: 'Open tool' }).click();

  const dialog = page.getByRole('region', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-upload-stage]')).toBeVisible();
  const pdf = await PDFDocument.create(); pdf.addPage([400, 600]);
  await dialog.locator('#workspace-file').setInputFiles({ name: 'layout.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await expect(dialog.locator('.workspace-grid.legacy-editor-shell')).toBeVisible();
  await expect(dialog.locator('.legacy-files-pane .drop-zone')).toBeVisible();
  await expect(dialog.locator('.legacy-center-pane')).toBeVisible();
  await expect(dialog.locator('.legacy-settings-pane')).toBeVisible();

  const dialogPresentation = await dialog.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderRadius: Number.parseFloat(style.borderRadius),
      shadow: style.boxShadow,
    };
  });
  expect(dialogPresentation.borderRadius).toBe(0);
  expect(dialogPresentation.shadow).toBe('none');

  const shellColumns = await dialog.locator('.workspace-grid.legacy-editor-shell').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(shellColumns).toBe(1);

  const editorColumns = await dialog.locator('.legacy-editor-body').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(editorColumns).toBe(3);

  const dropZonePresentation = await dialog.locator('.legacy-files-pane .drop-zone').evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderRadius: Number.parseFloat(style.borderRadius),
      borderStyle: style.borderStyle,
    };
  });
  expect(dropZonePresentation.borderRadius).toBeGreaterThanOrEqual(7);
  expect(dropZonePresentation.borderStyle).toBe('dashed');
});

test('phone discovery is compact with two-column tool cards and early search', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await expect(page.locator('.hero-art')).toBeHidden();
  const gridColumns = await page.locator('#tool-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(gridColumns).toBe(2);
  expect((await page.locator('#tool-search').boundingBox())!.y).toBeLessThan(600);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
