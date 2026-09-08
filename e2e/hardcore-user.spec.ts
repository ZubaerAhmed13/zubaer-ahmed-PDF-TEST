import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function pdfFixture(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    const page = doc.addPage([420 + index, 594 + index]);
    page.drawText(`Hardcore fixture page ${index + 1}`);
  }
  return Buffer.from(await doc.save());
}

async function openMerge(page: import('@playwright/test').Page) {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.getByLabel('Search tools').fill('merge');
  await page.getByRole('button', { name: 'Open tool' }).click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('removing a source keeps every visible file counter in sync', async ({ page }) => {
  const dialog = await openMerge(page);
  await dialog.locator('#workspace-file').setInputFiles([
    { name: 'alpha.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(1) },
    { name: 'beta.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(2) }
  ]);

  await expect(dialog.locator('#file-list .file-row')).toHaveCount(2);
  await expect(dialog.locator('[data-parity-file-status]')).toHaveText('2 files added.');
  await expect(dialog.locator('.workspace')).toHaveAttribute('data-parity-file-count', '2');

  await dialog.locator('#file-list .file-row').nth(1).getByRole('button', { name: 'Remove beta.pdf' }).click();

  await expect(dialog.locator('#file-list .file-row')).toHaveCount(1);
  await expect(dialog.locator('[data-parity-file-status]')).toHaveText('1 file added.');
  await expect(dialog.locator('.workspace')).toHaveAttribute('data-parity-file-count', '1');
});

test('duplicate filenames do not make the preview remove the wrong PDF', async ({ page }) => {
  const dialog = await openMerge(page);
  await dialog.locator('#workspace-file').setInputFiles([
    { name: 'duplicate.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(1) },
    { name: 'duplicate.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(3) }
  ]);

  const preview = dialog.locator('[data-pre-edit-preview]');
  await expect(preview).toHaveAttribute('data-preview-ready', 'true');
  await expect(dialog.locator('#file-list .file-row')).toHaveCount(2);

  // Remove the second, three-page PDF. The remaining core source is the one-page PDF.
  await dialog.locator('#file-list .file-row').nth(1).getByRole('button', { name: 'Remove duplicate.pdf' }).click();
  await expect(dialog.locator('#file-list .file-row')).toHaveCount(1);
  await expect(preview.locator('[data-pre-edit-source]')).toHaveCount(1);
  await expect(preview).toHaveAttribute('data-preview-ready', 'true');
  await expect(preview.locator('.pre-edit-thumbnail-item')).toHaveCount(1);
});

test('moving a merge source does not duplicate internal file state', async ({ page }) => {
  const dialog = await openMerge(page);
  await dialog.locator('#workspace-file').setInputFiles([
    { name: 'first.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(1) },
    { name: 'second.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(2) }
  ]);

  await expect(dialog.locator('#file-list .file-row')).toHaveCount(2);
  await expect(dialog.locator('.workspace')).toHaveAttribute('data-parity-file-count', '2');

  await dialog.getByRole('button', { name: 'Move second.pdf up' }).click();

  await expect(dialog.locator('#file-list .file-row').nth(0).locator('strong')).toHaveText('second.pdf');
  await expect(dialog.locator('#file-list .file-row').nth(1).locator('strong')).toHaveText('first.pdf');
  await expect(dialog.locator('.workspace')).toHaveAttribute('data-parity-file-count', '2');
  await expect(dialog.locator('[data-parity-file-status]')).toHaveText('2 files added.');
});

test('replacing one merge source does not double the restored UI state', async ({ page }) => {
  const dialog = await openMerge(page);
  await dialog.locator('#workspace-file').setInputFiles([
    { name: 'keep.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(1) },
    { name: 'replace-me.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(2) }
  ]);

  await expect(dialog.locator('#file-list .file-row')).toHaveCount(2);
  const chooserPromise = page.waitForEvent('filechooser');
  await dialog.locator('#file-list .file-row').nth(1).getByRole('button', { name: 'Replace' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'replacement.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(3) });

  await expect(dialog.locator('#file-list .file-row')).toHaveCount(2);
  await expect(dialog.locator('#file-list .file-row').nth(0).locator('strong')).toHaveText('keep.pdf');
  await expect(dialog.locator('#file-list .file-row').nth(1).locator('strong')).toHaveText('replacement.pdf');
  await expect(dialog.locator('.workspace')).toHaveAttribute('data-parity-file-count', '2');
  await expect(dialog.locator('[data-parity-file-status]')).toHaveText('2 files added.');
});

test('favoriting inside the workspace immediately updates Home quick access', async ({ page }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.getByLabel('Search tools').fill('rotate');
  await page.getByRole('button', { name: 'Open tool' }).click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Add Rotate pages to favorites' }).click();
  await dialog.locator('[data-legacy-header-close]').click();
  await expect(dialog).not.toBeVisible();

  await expect(page.locator('#favorite-tools [data-open-tool="rotate"]')).toBeVisible();
});

test('a failed lazy tool load never leaves the user trapped on Loading', async ({ page }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');

  // After the shell is loaded, block subsequent JS chunks to simulate a real lazy-load/cache/network failure.
  await page.route('**/assets/*.js', async (route) => {
    if (route.request().resourceType() === 'script') await route.abort();
    else await route.continue();
  });

  await page.getByLabel('Search tools').fill('merge');
  await page.getByRole('button', { name: 'Open tool' }).click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();

  // Correct UX: loading must resolve to either the tool or an actionable error state.
  await expect(dialog.locator('.workspace-loading')).not.toBeVisible({ timeout: 4_000 });
  await expect(dialog.locator('.workspace')).not.toContainText(/^Loading Merge PDF…$/);
});

test('closing and reopening a tool starts from a clean preview state', async ({ page }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.getByLabel('Search tools').fill('rotate');
  await page.getByRole('button', { name: 'Open tool' }).click();
  let dialog = page.getByRole('dialog', { name: 'Workspace' });
  await dialog.locator('#workspace-file').setInputFiles({
    name: 'first-open.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(4)
  });
  await expect(dialog.locator('[data-pre-edit-preview] .pre-edit-thumbnail-item')).toHaveCount(4);
  await dialog.locator('[data-legacy-header-close]').click();
  await expect(dialog).not.toBeVisible();

  await page.getByRole('button', { name: 'Open tool' }).click();
  dialog = page.getByRole('dialog', { name: 'Workspace' });
  await dialog.locator('#workspace-file').setInputFiles({
    name: 'second-open.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(1)
  });
  await expect(dialog.locator('[data-pre-edit-preview] .pre-edit-thumbnail-item')).toHaveCount(1);
  await expect(dialog.locator('#file-list .file-row')).toHaveCount(1);
});
