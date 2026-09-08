import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function pdfFixture(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) doc.addPage([595 + index, 842 + index]);
  return Buffer.from(await doc.save());
}

async function sourceIds(dialog: import('@playwright/test').Locator): Promise<{ rows: string[]; tabs: string[] }> {
  const rows = await dialog.locator('#file-list [data-remove]').evaluateAll((buttons) => buttons.map((button) => (button as HTMLElement).dataset.remove ?? ''));
  const tabs = await dialog.locator('[data-pre-edit-source]').evaluateAll((buttons) => buttons.map((button) => (button as HTMLElement).dataset.sourceId ?? ''));
  return { rows, tabs };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
});

test('same-named sources stay exact through move, replace and remove', async ({ page }) => {
  await page.locator('[data-open-tool="merge"]').first().click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();

  await dialog.locator('#workspace-file').setInputFiles([
    { name: 'duplicate.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(1) },
    { name: 'duplicate.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(3) }
  ]);

  const preview = dialog.locator('[data-pre-edit-preview]');
  await expect(preview.locator('[data-pre-edit-source]')).toHaveCount(2);
  await expect.poll(async () => (await sourceIds(dialog)).rows.join('|')).toBe((await sourceIds(dialog)).tabs.join('|'));

  await preview.locator('[data-pre-edit-source]').nth(1).click();
  await expect(preview.locator('.pre-edit-thumbnail-item')).toHaveCount(3);

  const secondRow = dialog.locator('#file-list .file-row').nth(1);
  await secondRow.locator('[data-parity-move="-1"]').click();
  await expect(preview.locator('[data-pre-edit-source]')).toHaveCount(2);
  await expect(preview.locator('.pre-edit-thumbnail-item')).toHaveCount(3);
  const movedIds = await sourceIds(dialog);
  expect(movedIds.rows).toEqual(movedIds.tabs);
  expect(new Set(movedIds.rows).size).toBe(2);

  const firstRow = dialog.locator('#file-list .file-row').first();
  await firstRow.locator('[data-parity-replace]').click();
  await dialog.locator('[data-parity-replacement-input]').setInputFiles({
    name: 'duplicate.pdf',
    mimeType: 'application/pdf',
    buffer: await pdfFixture(2)
  });
  await expect(preview.locator('[data-pre-edit-source]')).toHaveCount(2);
  await expect(preview.locator('.pre-edit-thumbnail-item')).toHaveCount(2);
  const replacedIds = await sourceIds(dialog);
  expect(replacedIds.rows).toEqual(replacedIds.tabs);
  expect(new Set(replacedIds.rows).size).toBe(2);

  await dialog.locator('#file-list [data-remove]').first().click();
  await expect(dialog.locator('#file-list [data-remove]')).toHaveCount(1);
  await expect(preview.locator('[data-pre-edit-source]')).toHaveCount(1);
  await expect(preview.locator('.pre-edit-thumbnail-item')).toHaveCount(1);
  const remainingIds = await sourceIds(dialog);
  expect(remainingIds.rows).toEqual(remainingIds.tabs);
});
