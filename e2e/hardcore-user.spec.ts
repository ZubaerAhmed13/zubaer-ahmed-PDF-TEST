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

async function openTool(page: import('@playwright/test').Page, id: string) {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.locator(`[data-open-tool="${id}"]`).click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('removing a source keeps every visible file counter in sync', async ({ page }) => {
  const dialog = await openTool(page, 'merge');
  await dialog.locator('#workspace-file').setInputFiles([
    { name: 'alpha.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(1) },
    { name: 'beta.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(2) }
  ]);

  await expect(dialog.locator('#file-list .file-row')).toHaveCount(2);
  await expect(dialog.locator('[data-parity-file-status]')).toHaveText('2 files added.');
  await expect(dialog.locator('.workspace')).toHaveAttribute('data-parity-file-count', '2');

  await dialog.locator('#file-list .file-row').nth(1).getByRole('button', { name: 'Remove beta.pdf', exact: true }).click();

  await expect(dialog.locator('#file-list .file-row')).toHaveCount(1);
  await expect(dialog.locator('[data-parity-file-status]')).toHaveText('1 file added.');
  await expect(dialog.locator('.workspace')).toHaveAttribute('data-parity-file-count', '1');
});

test('duplicate filenames do not make the preview remove the wrong PDF', async ({ page }) => {
  const dialog = await openTool(page, 'merge');
  await dialog.locator('#workspace-file').setInputFiles([
    { name: 'duplicate.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(1) },
    { name: 'duplicate.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(3) }
  ]);

  const preview = dialog.locator('[data-pre-edit-preview]');
  await expect(preview).toHaveAttribute('data-preview-ready', 'true');
  await expect(dialog.locator('#file-list .file-row')).toHaveCount(2);

  // Remove the second, three-page PDF. The remaining core source is the one-page PDF.
  await dialog.locator('#file-list .file-row').nth(1).locator('button[data-remove]').click();
  await expect(dialog.locator('#file-list .file-row')).toHaveCount(1);
  await expect(preview.locator('[data-pre-edit-source]')).toHaveCount(1);
  await expect(preview).toHaveAttribute('data-preview-ready', 'true');
  await expect(preview.locator('.pre-edit-thumbnail-item')).toHaveCount(1);
});

test('moving a merge source does not duplicate internal file state', async ({ page }) => {
  const dialog = await openTool(page, 'merge');
  await dialog.locator('#workspace-file').setInputFiles([
    { name: 'first.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(1) },
    { name: 'second.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(2) }
  ]);

  await expect(dialog.locator('#file-list .file-row')).toHaveCount(2);
  await expect(dialog.locator('.workspace')).toHaveAttribute('data-parity-file-count', '2');

  await dialog.getByRole('button', { name: 'Move second.pdf up', exact: true }).click();

  await expect(dialog.locator('#file-list .file-row').nth(0).locator('strong')).toHaveText('second.pdf');
  await expect(dialog.locator('#file-list .file-row').nth(1).locator('strong')).toHaveText('first.pdf');
  await expect(dialog.locator('.workspace')).toHaveAttribute('data-parity-file-count', '2');
  await expect(dialog.locator('[data-parity-file-status]')).toHaveText('2 files added.');
});

test('replacing one merge source does not double the restored UI state', async ({ page }) => {
  const dialog = await openTool(page, 'merge');
  await dialog.locator('#workspace-file').setInputFiles([
    { name: 'keep.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(1) },
    { name: 'replace-me.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(2) }
  ]);

  await expect(dialog.locator('#file-list .file-row')).toHaveCount(2);
  const replace = dialog.locator('#file-list .file-row').nth(1).locator('button.legacy-replace-file');
  await expect(replace).toHaveCount(1);
  await replace.click();
  const replacementInput = dialog.locator('[data-parity-replacement-input]');
  await expect(replacementInput).toHaveCount(1);
  await replacementInput.setInputFiles({
    name: 'replacement.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(3)
  });

  await expect(dialog.locator('#file-list .file-row')).toHaveCount(2);
  await expect(dialog.locator('#file-list .file-row').nth(0).locator('strong')).toHaveText('keep.pdf');
  await expect(dialog.locator('#file-list .file-row').nth(1).locator('strong')).toHaveText('replacement.pdf');
  await expect(dialog.locator('.workspace')).toHaveAttribute('data-parity-file-count', '2');
  await expect(dialog.locator('[data-parity-file-status]')).toHaveText('2 files added.');
  await expect(dialog.locator('[data-pre-edit-source]')).toHaveCount(2);
});

test('favoriting inside the workspace immediately updates Home quick access', async ({ page }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('[data-open-tool="rotate"]').click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Add Rotate pages to favorites', exact: true }).click();
  await dialog.locator('[data-legacy-header-close]').click();
  await expect(dialog).not.toBeVisible();

  await expect(page.locator('#favorite-tools [data-open-tool="rotate"]')).toBeVisible();
});

test('a real failed lazy tool chunk load never leaves the user trapped on Loading', async ({ page }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  let blocked = 0;
  await page.route('**/assets/workspaceWithRecovery-*.js', async (route) => {
    blocked += 1;
    await route.abort();
  });

  await page.locator('[data-open-tool="merge"]').click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => blocked).toBeGreaterThan(0);

  // Correct UX: loading must resolve to an actionable error rather than an endless spinner/message.
  await expect(dialog.locator('.workspace-loading')).not.toBeVisible({ timeout: 4_000 });
  await expect(dialog.locator('.workspace')).not.toContainText(/^Loading Merge PDF…$/);
});

test('closing and reopening a tool starts from a clean preview state', async ({ page }) => {
  const dialog = await openTool(page, 'rotate');
  await dialog.locator('#workspace-file').setInputFiles({
    name: 'first-open.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(4)
  });
  await expect(dialog.locator('[data-pre-edit-preview] .pre-edit-thumbnail-item')).toHaveCount(4);
  await dialog.locator('[data-legacy-header-close]').click();
  await expect(dialog).not.toBeVisible();

  await page.locator('[data-open-tool="rotate"]').click();
  await expect(dialog).toBeVisible();
  await dialog.locator('#workspace-file').setInputFiles({
    name: 'second-open.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(1)
  });
  await expect(dialog.locator('[data-pre-edit-preview] .pre-edit-thumbnail-item')).toHaveCount(1);
  await expect(dialog.locator('#file-list .file-row')).toHaveCount(1);
});

test('closing a tool while its lazy chunk is still loading does not mount stale UI afterward', async ({ page }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  let intercepted = 0;
  await page.route('**/assets/workspaceWithRecovery-*.js', async (route) => {
    intercepted += 1;
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });

  await page.locator('[data-open-tool="merge"]').click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => intercepted).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();

  // Wait until the delayed dynamic import has had time to finish. Closed workspace must remain clean.
  await page.waitForTimeout(1_000);
  await expect(page.locator('#workspace')).toBeEmpty();
});
