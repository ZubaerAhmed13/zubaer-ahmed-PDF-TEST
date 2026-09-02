import { expect, test } from '@playwright/test';

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

test('core shell survives an offline reload after runtime caching', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Offline PWA smoke test is certified in Chromium first.');
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.waitForFunction(() => 'serviceWorker' in navigator);
  await page.waitForTimeout(800);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: /Private PDF tools/ })).toBeVisible();
  await context.setOffline(false);
});
