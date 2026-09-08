import { expect, test } from '@playwright/test';

const appUrl = '/zubaer-ahmed-PDF-TEST/';
const workspaceChunk = '**/assets/workspaceWithRecovery-*.js';

test.beforeEach(async ({ page }) => {
  await page.goto(appUrl);
});

test('lazy-load failure is recoverable and Retry really opens the editor', async ({ page }) => {
  let failuresRemaining = 1;
  await page.route(workspaceChunk, async (route) => {
    if (failuresRemaining > 0) {
      failuresRemaining -= 1;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await page.locator('[data-open-tool="merge"]').first().click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.workspace-loading')).toHaveCount(0);
  await expect(dialog.getByRole('heading', { name: 'Unable to open Merge PDF' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Reload application' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Retry' }).click();
  await expect(dialog.getByRole('heading', { name: 'Merge PDF' })).toBeVisible();
  await expect(dialog.locator('.workspace-loading')).toHaveCount(0);
  await expect(dialog.locator('[data-load-error-for="merge"]')).toHaveCount(0);
});

test('closing during a delayed lazy load permanently invalidates that open session', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let delayed = false;
  await page.route(workspaceChunk, async (route) => {
    if (!delayed) {
      delayed = true;
      await gate;
    }
    await route.continue();
  });

  await page.locator('[data-open-tool="merge"]').first().click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog.locator('.workspace-loading')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  release();
  await page.waitForTimeout(300);
  await expect(dialog).toBeHidden();
  await expect(page.locator('#workspace')).toBeEmpty();
  await expect(page.locator('#workspace .workspace-grid')).toHaveCount(0);
  await expect(page.locator('#workspace [data-pre-edit-preview]')).toHaveCount(0);

  await page.unroute(workspaceChunk);
  await page.locator('[data-open-tool="merge"]').first().click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Merge PDF' })).toBeVisible();
});
