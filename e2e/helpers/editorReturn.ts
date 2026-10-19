import { expect, type Page } from '@playwright/test';

/** Engine regression journeys explicitly return from the new completion page
 * before inspecting advanced per-tool output controls. Page-journey tests
 * independently certify the default completion/download experience. */
export async function returnToEditor(page: Page): Promise<void> {
  const result = page.locator('[data-result-page]');
  await expect(page.locator('.page-toolbar')).not.toHaveAttribute('data-busy', 'true', { timeout: 90_000 });
  if (await result.isVisible()) {
    await result.getByRole('button', { name: 'Return to editing', exact: true }).click();
    await expect(result).toBeHidden();
  }
}

export async function closeToolPage(page: Page): Promise<void> {
  await page.locator('[data-page-home]').first().click();
  const confirmation = page.getByRole('dialog', { name: 'Leave unapplied tool changes?', exact: true });
  if (await confirmation.isVisible()) await confirmation.getByRole('button', { name: 'Leave tool', exact: true }).click();
  await expect(page.locator('#workspace-dialog')).toBeHidden();
}
