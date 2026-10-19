import { expect, test } from '@playwright/test';

test('keyboard-only dialog flows keep focus contained and return it to the exact trigger', async ({ page }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.getByLabel('Search tools').fill('merge');
  const openMerge = page.locator('#tool-grid [data-open-tool="merge"]');
  await openMerge.focus();
  await expect(openMerge).toBeFocused();
  await page.keyboard.press('Enter');

  const workspace = page.getByRole('region', { name: 'Workspace' });
  await expect(workspace).toBeVisible();
  expect(await page.evaluate(() => document.querySelector('#workspace-dialog')?.contains(document.activeElement))).toBe(true);
  await page.getByRole('button', { name: 'Back to all tools', exact: true }).click();
  await expect(workspace).toBeHidden();
  await expect(page.getByLabel('Search tools')).toBeFocused();

  const privacy = page.locator('.topbar-nav').getByRole('button', { name: 'Privacy' });
  await privacy.focus();
  // Reproduce a late-arriving close event after the user has moved focus.
  // Restoration must not steal keyboard focus back to the previous tool.
  await page.locator('#workspace-dialog').dispatchEvent('close');
  await expect(privacy).toBeFocused();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(privacy).toBeFocused();
  await page.keyboard.press('Enter');
  const info = page.locator('#info-dialog');
  await expect(info).toBeVisible();
  expect(await page.evaluate(() => document.querySelector('#info-dialog')?.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(info).toBeHidden();
  await expect(privacy).toBeFocused();
});
