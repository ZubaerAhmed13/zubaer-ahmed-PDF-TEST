import { expect, test } from '@playwright/test';

test('keyboard-only dialog flows keep focus contained and return it to the exact trigger', async ({ page }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.getByLabel('Search tools').fill('merge');
  const openMerge = page.locator('#tool-grid [data-open-tool="merge"]');
  await openMerge.focus();
  await expect(openMerge).toBeFocused();
  await page.keyboard.press('Enter');

  const workspace = page.getByRole('dialog', { name: 'Workspace' });
  await expect(workspace).toBeVisible();
  expect(await page.evaluate(() => document.querySelector('#workspace-dialog')?.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(workspace).toBeHidden();
  await expect(openMerge).toBeFocused();

  const privacy = page.getByRole('button', { name: 'Privacy' });
  await privacy.focus();
  await expect(privacy).toBeFocused();
  await page.keyboard.press('Enter');
  const info = page.locator('#info-dialog');
  await expect(info).toBeVisible();
  expect(await page.evaluate(() => document.querySelector('#info-dialog')?.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(info).toBeHidden();
  await expect(privacy).toBeFocused();
});
