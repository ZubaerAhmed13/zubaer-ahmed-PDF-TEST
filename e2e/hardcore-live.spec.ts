import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

const LIVE = 'https://zubaerahmed13.github.io/zubaer-ahmed-PDF-TEST/';

async function pdfFixture(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    const page = doc.addPage([420 + index, 594 + index]);
    page.drawText(`Live hardcore fixture page ${index + 1}`);
  }
  return Buffer.from(await doc.save());
}

async function liveOpen(page: import('@playwright/test').Page, id: string) {
  await page.goto(LIVE, { waitUntil: 'domcontentloaded' });
  await page.locator(`#tool-grid [data-open-tool="${id}"]`).click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('LIVE: duplicate filenames keep file list and preview on the same remaining PDF', async ({ page }) => {
  const dialog = await liveOpen(page, 'merge');
  await dialog.locator('#workspace-file').setInputFiles([
    { name: 'duplicate.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(1) },
    { name: 'duplicate.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(3) }
  ]);
  const preview = dialog.locator('[data-pre-edit-preview]');
  await expect(preview).toHaveAttribute('data-preview-ready', 'true');
  await dialog.locator('#file-list .file-row').nth(1).locator('button[data-remove]').click();
  await expect(dialog.locator('#file-list .file-row')).toHaveCount(1);
  await expect(preview.locator('[data-pre-edit-source]')).toHaveCount(1);
  await expect(preview.locator('.pre-edit-thumbnail-item')).toHaveCount(1);
});

test('LIVE: workspace favorite immediately appears in Home quick access', async ({ page }) => {
  await page.goto(LIVE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#tool-grid [data-open-tool="rotate"]').click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Add Rotate pages to favorites', exact: true }).click();
  await dialog.locator('[data-legacy-header-close]').click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('#favorite-tools [data-open-tool="rotate"]')).toBeVisible();
});

test('LIVE: close and reopen starts from a clean preview and file state', async ({ page }) => {
  const dialog = await liveOpen(page, 'rotate');
  await dialog.locator('#workspace-file').setInputFiles({
    name: 'first.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(4)
  });
  await expect(dialog.locator('[data-pre-edit-preview] .pre-edit-thumbnail-item')).toHaveCount(4);
  await dialog.locator('[data-legacy-header-close]').click();
  await expect(dialog).not.toBeVisible();

  await page.locator('#tool-grid [data-open-tool="rotate"]').click();
  await expect(dialog).toBeVisible();
  await dialog.locator('#workspace-file').setInputFiles({
    name: 'second.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(1)
  });
  await expect(dialog.locator('#file-list .file-row')).toHaveCount(1);
  await expect(dialog.locator('[data-pre-edit-preview] .pre-edit-thumbnail-item')).toHaveCount(1);
});

test('LIVE: failed lazy tool chunk produces recovery UI instead of endless Loading', async ({ page }) => {
  await page.goto(LIVE, { waitUntil: 'domcontentloaded' });
  let blocked = 0;
  await page.route('**/*', async (route) => {
    if (route.request().url().includes('workspaceWithRecovery-') && route.request().url().endsWith('.js')) {
      blocked += 1;
      await route.abort();
      return;
    }
    await route.continue();
  });
  await page.locator('#tool-grid [data-open-tool="merge"]').click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => blocked).toBeGreaterThan(0);
  await expect(dialog.locator('.workspace-loading')).not.toBeVisible({ timeout: 4_000 });
});

test('LIVE: closing while a lazy tool chunk loads cannot remount stale UI after cleanup', async ({ page }) => {
  await page.goto(LIVE, { waitUntil: 'domcontentloaded' });
  let delayed = 0;
  await page.route('**/*', async (route) => {
    if (route.request().url().includes('workspaceWithRecovery-') && route.request().url().endsWith('.js')) {
      delayed += 1;
      await new Promise((resolve) => setTimeout(resolve, 900));
      await route.continue();
      return;
    }
    await route.continue();
  });
  await page.locator('#tool-grid [data-open-tool="merge"]').click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => delayed).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await page.waitForTimeout(1_200);
  await expect(page.locator('#workspace')).toBeEmpty();
});

test('LIVE: rapid double-open does not produce an unhandled dialog/runtime error', async ({ page }) => {
  await page.goto(LIVE, { waitUntil: 'domcontentloaded' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('#tool-grid [data-open-tool="merge"]').dblclick();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.workspace-grid')).toBeVisible();
  expect(errors).toEqual([]);
});
