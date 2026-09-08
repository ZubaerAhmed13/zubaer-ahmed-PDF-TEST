import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function pdfFixture(pageCount: number, width = 595.28, height = 841.89): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) doc.addPage([width + index, height + index]);
  return Buffer.from(await doc.save());
}

async function openTool(page: import('@playwright/test').Page, toolId: string): Promise<import('@playwright/test').Locator> {
  await page.locator(`[data-open-tool="${toolId}"]`).first().click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
});

test('pre-edit viewer exposes working zoom controls and owns vertical/horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  const dialog = await openTool(page, 'remove-pages');
  await dialog.locator('#workspace-file').setInputFiles({
    name: 'scroll-source.pdf',
    mimeType: 'application/pdf',
    buffer: await pdfFixture(2, 700, 1000)
  });

  const preview = dialog.locator('[data-pre-edit-preview]');
  await expect(preview).toHaveAttribute('data-preview-ready', 'true');
  const shell = preview.locator('.pre-edit-canvas-shell');
  const zoomIn = preview.getByRole('button', { name: 'Zoom in' });
  const zoomOut = preview.getByRole('button', { name: 'Zoom out' });
  await expect(zoomIn).toBeVisible();
  await expect(zoomOut).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Actual size' })).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Fit width' })).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Fit page' })).toBeVisible();

  await preview.getByRole('button', { name: 'Actual size' }).click();
  await expect(preview.locator('[data-pre-edit-zoom]')).toHaveText('100%');
  for (let index = 0; index < 8; index += 1) await zoomIn.click();
  const overflow = await shell.evaluate((element) => ({
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
    scrollWidth: element.scrollWidth,
    scrollHeight: element.scrollHeight
  }));
  expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth);
  expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight);

  await shell.hover();
  const beforeY = await shell.evaluate((element) => element.scrollTop);
  await page.mouse.wheel(0, 320);
  await expect.poll(() => shell.evaluate((element) => element.scrollTop)).toBeGreaterThan(beforeY);

  const beforeX = await shell.evaluate((element) => element.scrollLeft);
  await page.mouse.wheel(320, 0);
  await expect.poll(() => shell.evaluate((element) => element.scrollLeft)).toBeGreaterThan(beforeX);

  const documentOverflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth
  }));
  expect(documentOverflow.scrollWidth).toBeLessThanOrEqual(documentOverflow.viewportWidth + 1);

  await preview.getByRole('button', { name: 'Fit width' }).click();
  const fitWidth = await shell.evaluate((element) => {
    const canvas = element.querySelector('canvas');
    if (!canvas) throw new Error('Preview canvas missing.');
    return { canvasWidth: canvas.getBoundingClientRect().width, clientWidth: element.clientWidth };
  });
  expect(fitWidth.canvasWidth).toBeLessThanOrEqual(fitWidth.clientWidth);

  await preview.getByRole('button', { name: 'Fit page' }).click();
  const fitPage = await shell.evaluate((element) => {
    const canvas = element.querySelector('canvas');
    if (!canvas) throw new Error('Preview canvas missing.');
    const rect = canvas.getBoundingClientRect();
    return { width: rect.width, height: rect.height, clientWidth: element.clientWidth, clientHeight: element.clientHeight };
  });
  expect(fitPage.width).toBeLessThanOrEqual(fitPage.clientWidth);
  expect(fitPage.height).toBeLessThanOrEqual(fitPage.clientHeight);
});

test('Files and Settings panes independently consume wheel scrolling on a short laptop viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  let dialog = await openTool(page, 'merge');
  const inputs = await Promise.all(Array.from({ length: 10 }, async (_, index) => ({
    name: `source-${index + 1}.pdf`,
    mimeType: 'application/pdf',
    buffer: await pdfFixture(1)
  })));
  await dialog.locator('#workspace-file').setInputFiles(inputs);

  const filesPane = dialog.locator('.legacy-files-pane');
  const filesMetrics = await filesPane.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
  expect(filesMetrics.scrollHeight).toBeGreaterThan(filesMetrics.clientHeight);
  await filesPane.hover();
  const filesBefore = await filesPane.evaluate((element) => element.scrollTop);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => filesPane.evaluate((element) => element.scrollTop)).toBeGreaterThan(filesBefore);

  await dialog.locator('.legacy-footer-close').click();
  await expect(dialog).toBeHidden();
  dialog = await openTool(page, 'forms');
  await dialog.locator('#workspace-file').setInputFiles({
    name: 'form-source.pdf',
    mimeType: 'application/pdf',
    buffer: await pdfFixture(1)
  });

  const settingsPane = dialog.locator('.legacy-settings-pane');
  const settingsMetrics = await settingsPane.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
  expect(settingsMetrics.scrollHeight).toBeGreaterThan(settingsMetrics.clientHeight);
  await settingsPane.hover();
  const settingsBefore = await settingsPane.evaluate((element) => element.scrollTop);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => settingsPane.evaluate((element) => element.scrollTop)).toBeGreaterThan(settingsBefore);
});

test('representative restored editors remain navigable at constrained desktop height', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  for (const toolId of ['merge', 'remove-pages', 'rotate', 'compress', 'forms']) {
    const dialog = await openTool(page, toolId);
    await dialog.locator('#workspace-file').setInputFiles({
      name: `${toolId}.pdf`,
      mimeType: 'application/pdf',
      buffer: await pdfFixture(2)
    });
    const preview = dialog.locator('[data-pre-edit-preview]');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute('data-preview-ready', 'true');
    await expect(preview.locator('.pre-edit-canvas-shell')).toBeVisible();
    await expect(dialog.locator('.legacy-footer-close')).toBeVisible();
    await dialog.locator('.legacy-footer-close').click();
    await expect(dialog).toBeHidden();
  }
});

test('stacked mobile editor remains scrollable without browser-page horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  const dialog = await openTool(page, 'remove-pages');
  await dialog.locator('#workspace-file').setInputFiles({
    name: 'mobile-source.pdf',
    mimeType: 'application/pdf',
    buffer: await pdfFixture(2, 700, 1000)
  });

  const preview = dialog.locator('[data-pre-edit-preview]');
  await expect(preview).toHaveAttribute('data-preview-ready', 'true');
  await expect(preview.getByRole('button', { name: 'Zoom in' })).toBeVisible();
  const body = dialog.locator('.legacy-editor-body');
  const bodyMetrics = await body.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
  expect(bodyMetrics.scrollHeight).toBeGreaterThan(bodyMetrics.clientHeight);
  await body.hover();
  const bodyBefore = await body.evaluate((element) => element.scrollTop);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(bodyBefore);

  const documentOverflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth
  }));
  expect(documentOverflow.scrollWidth).toBeLessThanOrEqual(documentOverflow.viewportWidth + 1);
});

test('duplicate filenames keep the tool source and preview source synchronized', async ({ page }) => {
  const dialog = await openTool(page, 'merge');
  await dialog.locator('#workspace-file').setInputFiles([
    { name: 'duplicate.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(1) },
    { name: 'duplicate.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(3) }
  ]);

  const preview = dialog.locator('[data-pre-edit-preview]');
  await expect(preview.locator('[data-pre-edit-source]')).toHaveCount(2);
  await preview.locator('[data-pre-edit-source]').nth(1).click();
  await expect(preview.locator('.pre-edit-thumbnail-item')).toHaveCount(3);

  const removeButtons = dialog.locator('[data-remove]');
  await expect(removeButtons).toHaveCount(2);
  const secondId = await removeButtons.nth(1).getAttribute('data-remove');
  expect(secondId).toBeTruthy();
  await removeButtons.nth(1).click();

  await expect(dialog.locator('[data-remove]')).toHaveCount(1);
  await expect(preview.locator('[data-pre-edit-source]')).toHaveCount(1);
  await expect(preview.locator('.pre-edit-thumbnail-item')).toHaveCount(1);
  await expect(preview.locator('[data-pre-edit-source]').first()).toHaveAttribute('data-source-id', /.+/);
});

test('workspace favorite synchronizes with Home immediately in both directions', async ({ page }) => {
  await page.evaluate(() => localStorage.removeItem('docflow.favorites.v1'));
  await page.reload();
  const dialog = await openTool(page, 'rotate');
  const editorFavorite = dialog.locator('.legacy-favorite-button');
  await expect(editorFavorite).toHaveAttribute('aria-pressed', 'false');
  await editorFavorite.click();
  await expect(editorFavorite).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(dialog).toBeHidden();

  const homeFavorite = page.locator('#favorite-tools [data-open-tool="rotate"]');
  await expect(homeFavorite).toBeVisible();
  const cardFavorite = page.locator('[data-tool="rotate"] [data-favorite="rotate"]');
  await cardFavorite.click();
  await expect(homeFavorite).toHaveCount(0);

  await page.locator('[data-open-tool="rotate"]').first().click();
  await expect(page.getByRole('dialog', { name: 'Workspace' }).locator('.legacy-favorite-button')).toHaveAttribute('aria-pressed', 'false');
});

test('failed lazy tool load leaves a recoverable error instead of endless Loading', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Network interception certification is required in Chromium; cross-engine coverage is best-effort.');
  let failed = false;
  await page.route('**/*.js', async (route) => {
    if (!failed && route.request().url().includes('/assets/')) {
      failed = true;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await page.locator('[data-open-tool="merge"]').first().click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.workspace-loading')).toHaveCount(0);
  await expect(dialog.getByRole('heading', { name: 'Unable to open Merge PDF' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();
});

test('closing during lazy load invalidates the stale open session', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Deterministic delayed-chunk interception is certified in Chromium.');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let delayed = false;
  await page.route('**/*.js', async (route) => {
    if (!delayed && route.request().url().includes('/assets/')) {
      delayed = true;
      await gate;
    }
    await route.continue();
  });

  await page.locator('[data-open-tool="merge"]').first().click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog.locator('.workspace-loading')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  release();
  await page.waitForTimeout(250);
  await expect(dialog).toBeHidden();
  await expect(page.locator('#workspace')).toBeEmpty();

  await page.unroute('**/*.js');
  await page.locator('[data-open-tool="merge"]').first().click();
  await expect(page.getByRole('dialog', { name: 'Workspace' }).getByRole('heading', { name: 'Merge PDF' })).toBeVisible();
});
