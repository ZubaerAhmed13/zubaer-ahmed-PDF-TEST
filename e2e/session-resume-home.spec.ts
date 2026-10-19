import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

test('home consistently exposes a retained document after leaving a dedicated tool', async ({ page }) => {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 420]);
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.getByRole('button', { name: 'Open a PDF', exact: true }).click();
  await page.locator('#workspace-file').setInputFiles({
    name: 'my-document.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save())
  });
  await expect(page.locator('.session-identity')).toContainText('my-document.pdf');
  await expect(page.locator('#stage')).toContainText('Preview ready');
  await page.getByRole('button', { name: 'Back to all tools', exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('button', { name: 'Resume document', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume document', exact: true }).click();
  await expect(page.locator('.session-identity')).toContainText('my-document.pdf');
});
