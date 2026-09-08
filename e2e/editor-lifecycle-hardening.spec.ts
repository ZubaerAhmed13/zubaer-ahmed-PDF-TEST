import { expect, test } from '@playwright/test';

const appUrl = '/zubaer-ahmed-PDF-TEST/';
const workspaceChunk = '**/assets/workspaceWithRecovery-*.js';

/* Network-failure certification must observe the real chunk request rather
 * than a previously installed service worker response. Production PWA behavior
 * is covered separately by the existing release/offline tests. */
test.use({ serviceWorkers: 'block' });

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
  await page.goto(appUrl);

  await page.locator('[data-open-tool="merge"]').first().click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.workspace-loading')).toHaveCount(0);
  await expect(dialog.getByRole('heading', { name: 'Unable to open Merge PDF', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Reload application' })).toBeVisible();

  /* Retry intentionally reloads the document because a rejected native module
   * import can remain rejected in the current page's module map. The retry id
   * survives only long enough to reopen the tool once on the fresh page. */
  await dialog.getByRole('button', { name: 'Retry' }).click();
  await expect(dialog.getByRole('heading', { name: 'Merge PDF', exact: true })).toBeVisible();
  await expect(dialog.locator('.workspace-loading')).toHaveCount(0);
  await expect(dialog.locator('[data-load-error-for="merge"]')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('docflow.retry-tool.v1'))).toBeNull();
});

test('closing during a delayed lazy load permanently invalidates that open session', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let released = false;
  const releaseOnce = (): void => {
    if (released) return;
    released = true;
    release();
  };
  let delayed = false;
  await page.route(workspaceChunk, async (route) => {
    if (!delayed) {
      delayed = true;
      await gate;
    }
    await route.continue();
  });
  await page.goto(appUrl);

  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  try {
    await page.locator('[data-open-tool="merge"]').first().click();
    await expect(dialog.locator('.workspace-loading')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    releaseOnce();
    await page.waitForTimeout(300);
    await expect(dialog).toBeHidden();
    await expect(page.locator('#workspace')).toBeEmpty();
    await expect(page.locator('#workspace .workspace-grid')).toHaveCount(0);
    await expect(page.locator('#workspace [data-pre-edit-preview]')).toHaveCount(0);
  } finally {
    /* Never leave an intercepted module request blocked if an assertion above
     * fails. An unresolved route handler can otherwise keep browser teardown
     * alive indefinitely and hide the actual assertion failure from CI. */
    releaseOnce();
  }

  await page.unroute(workspaceChunk);
  await page.locator('[data-open-tool="merge"]').first().click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Merge PDF', exact: true })).toBeVisible();
});
