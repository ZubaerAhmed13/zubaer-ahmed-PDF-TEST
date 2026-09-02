import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function pdfFixture(): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.addPage([320, 480]);
  return Buffer.from(await document.save());
}

async function openRotateTool(page: import('@playwright/test').Page): Promise<void> {
  await page.getByLabel('Search tools').fill('rotate pages');
  const rotateCard = page.locator('[data-tool="rotate"]');
  await expect(rotateCard.getByRole('heading', { name: 'Rotate pages' })).toBeVisible();
  await rotateCard.getByRole('button', { name: 'Open tool' }).click();
}

test('persists lightweight project metadata and settings without storing file contents', async ({ page }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await openRotateTool(page);
  let dialog = page.getByRole('dialog', { name: 'Workspace' });

  await dialog.locator('#workspace-file').setInputFiles({
    name: 'recovery-fixture.pdf',
    mimeType: 'application/pdf',
    buffer: await pdfFixture()
  });
  await dialog.locator('select[name="degrees"]').selectOption('180');
  await expect(dialog.locator('[data-project-save-status]')).toContainText('Recovery state saved locally');

  const stored = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('docflow-project-state', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        const transaction = database.transaction('snapshots', 'readonly');
        const request = transaction.objectStore('snapshots').get('last');
        request.onsuccess = () => resolve(request.result as Record<string, unknown>);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
  expect(stored).toMatchObject({
    toolId: 'rotate',
    files: [{ name: 'recovery-fixture.pdf', type: 'application/pdf' }],
    options: { degrees: '180' }
  });
  const storedFiles = stored.files as Array<Record<string, unknown>>;
  expect(Object.keys(storedFiles[0] ?? {}).sort()).toEqual(['lastModified', 'name', 'size', 'type']);

  await dialog.getByRole('button', { name: 'Close workspace' }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  await openRotateTool(page);
  dialog = page.getByRole('dialog', { name: 'Workspace' });
  const recovery = dialog.locator('[data-recovery-panel]');
  await expect(recovery).toBeVisible();
  await expect(recovery).toContainText('recovery-fixture.pdf');
  await expect(recovery).toContainText('contents were not stored');
  await expect(dialog.locator('select[name="degrees"]')).toHaveValue('180');
  await expect(dialog.locator('#file-list .file-row')).toHaveCount(0);

  await recovery.getByRole('button', { name: 'Clear recovery' }).click();
  await expect(recovery).toBeHidden();
  await expect(dialog.locator('[data-project-save-status]')).toContainText('Local recovery state cleared');
});
