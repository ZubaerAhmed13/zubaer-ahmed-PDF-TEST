import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function manyPageFixture(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) doc.addPage([300 + (index % 5) * 20, 420 + (index % 7) * 18]);
  return Buffer.from(await doc.save());
}

test('virtualizes the thumbnail DOM and lazily renders only the visible page window', async ({ page }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.getByLabel('Search tools').fill('view pdf');
  await page.locator('#tool-grid [data-open-tool="preview"]').click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await dialog.locator('#workspace-file').setInputFiles({
    name: 'forty-pages.pdf',
    mimeType: 'application/pdf',
    buffer: await manyPageFixture(40)
  });
  await dialog.getByRole('button', { name: 'Run View PDF' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Preview ready');
  await expect(dialog.locator('#viewer-status')).toHaveText('Page 1 of 40');

  const track = dialog.locator('.thumbnail-track');
  await expect(track).toHaveAttribute('data-page-count', '40');
  const items = dialog.locator('.thumbnail-item');
  await expect(items.first()).toBeVisible();
  const initialCount = await items.count();
  expect(initialCount).toBeGreaterThan(0);
  expect(initialCount).toBeLessThan(40);
  await expect(dialog.locator('.thumbnail-item[data-thumbnail-state="rendered"]').first()).toBeVisible();

  const rail = dialog.locator('.thumbnail-rail');
  await rail.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll'));
  });
  const lastPage = dialog.locator('.thumbnail-item[data-thumbnail-page="40"]');
  await expect(lastPage).toBeVisible();
  await lastPage.click();
  await expect(dialog.locator('#viewer-status')).toHaveText('Page 40 of 40');
  await expect(lastPage).toHaveAttribute('aria-current', 'page');
});
