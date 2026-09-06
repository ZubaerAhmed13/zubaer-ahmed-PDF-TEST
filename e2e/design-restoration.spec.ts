import { expect, test } from '@playwright/test';

test('restored DocFlow shell keeps the approved legacy visual hierarchy without breaking tool discovery', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/zubaer-ahmed-PDF-TEST/');

  await expect(page.locator('.hero-copy')).toBeVisible();
  await expect(page.locator('.hero-art .workspace-window')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Private PDF tools/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose an operation' })).toBeVisible();
  await expect(page.locator('#how-it-works')).toBeVisible();
  await expect(page.locator('#privacy-section')).toBeVisible();

  const heroColumns = await page.locator('.hero').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(heroColumns).toBeGreaterThanOrEqual(2);

  const gridColumns = await page.locator('#tool-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(gridColumns).toBe(3);

  await expect(page.locator('.tool-card').first().locator('.tool-category-label')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Privacy' }).first()).toBeVisible();

  await page.getByLabel('Search tools').fill('merge');
  await expect(page.getByRole('heading', { name: 'Merge PDF' })).toBeVisible();
  await page.getByRole('button', { name: 'Open tool' }).click();

  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
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
  // The approved screenshot-parity workspace deliberately uses a compact
  // ~11px frame radius rather than the superseded rounded-card shell.
  expect(dialogPresentation.borderRadius).toBeGreaterThanOrEqual(10);
  expect(dialogPresentation.shadow).not.toBe('none');

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

test('restored shell remains compact and single-column on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await expect(page.locator('.hero-art')).toBeHidden();
  const gridColumns = await page.locator('#tool-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(gridColumns).toBe(1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
