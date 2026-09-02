import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function pdfFixture(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) doc.addPage([300 + index, 400 + index]);
  return Buffer.from(await doc.save());
}

test('loads professional shell and exposes tool discovery', async ({ page }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await expect(page.getByRole('heading', { name: /Private PDF tools/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose an operation' })).toBeVisible();
  await page.getByLabel('Search tools').fill('merge');
  await expect(page.getByRole('heading', { name: 'Merge PDF' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rotate pages' })).toHaveCount(0);
});

test('Ctrl/Cmd+K moves focus to global search', async ({ page }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await expect(page.getByLabel('Search tools')).toBeFocused();
});

test('opens a unified workspace and closes with Escape', async ({ page }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.getByRole('button', { name: 'Open tool' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('runs a real worker-backed merge workflow', async ({ page }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.getByLabel('Search tools').fill('merge');
  await page.getByRole('button', { name: 'Open tool' }).click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  await dialog.locator('#workspace-file').setInputFiles([
    { name: 'one.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(1) },
    { name: 'two.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(2) }
  ]);
  await expect(dialog.getByText('one.pdf')).toBeVisible();
  await expect(dialog.getByText('two.pdf')).toBeVisible();
  await dialog.getByRole('button', { name: 'Run Merge PDF' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Complete');
  await expect(dialog.getByRole('link', { name: /Download merged\.pdf/ })).toBeVisible();
});

test('runs a local PDF operation after an offline reload', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Service-worker offline certification is executed in Chromium; other engines retain their online worker workflow coverage.');
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active);
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: /Private PDF tools/ })).toBeVisible();

  await page.getByLabel('Search tools').fill('merge');
  await page.getByRole('button', { name: 'Open tool' }).click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await dialog.locator('#workspace-file').setInputFiles([
    { name: 'offline-one.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(1) },
    { name: 'offline-two.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(2) }
  ]);
  await dialog.getByRole('button', { name: 'Run Merge PDF' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Complete');
  await expect(dialog.getByRole('link', { name: /Download merged\.pdf/ })).toBeVisible();

  await context.setOffline(false);
});
