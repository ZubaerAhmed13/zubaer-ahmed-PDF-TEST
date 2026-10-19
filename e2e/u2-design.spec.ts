import { expect, test } from '@playwright/test';

const base = '/zubaer-ahmed-PDF-TEST/';

test('home provides working task shortcuts, not decorative links', async ({ page }) => {
  await page.goto(base);
  const quickTools = page.locator('.hero-shortcuts [data-open-tool]');
  await expect(quickTools).toHaveCount(4);
  await expect(page.locator('#tool-search')).toBeVisible();
  await quickTools.filter({ hasText: 'Merge PDFs' }).click();
  await expect(page).toHaveURL(/#\/tools\/merge$/);
  await expect(page.locator('[data-upload-stage] h1')).toHaveText('Merge PDF');
  await expect(page.locator('[data-select-source]')).toBeEnabled();
  await page.locator('[data-page-home]').first().click();
  await expect(page.locator('#tool-search')).toBeVisible();
});

test('category filters support arrow, Home and End keys with roving tab focus', async ({ page }) => {
  await page.goto(base);
  const tabs = page.locator('.category-tabs [role="tab"]');
  await tabs.first().focus();
  await tabs.first().press('ArrowRight');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.nth(1)).toHaveAttribute('tabindex', '0');
  await expect(tabs.first()).toHaveAttribute('tabindex', '-1');
  await expect(page.locator('#tool-grid article.tool-card').first()).toHaveAttribute('data-category', 'organize');
  await tabs.nth(1).press('End');
  await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
  await tabs.last().press('Home');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#tool-grid article.tool-card')).toHaveCount(29);
});

test('small-phone discovery keeps main controls reachable without sideways scrolling', async ({ page }) => {
  for (const width of [390, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await page.goto(base);
    await expect(page.getByRole('button', { name: 'Open a PDF', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await page.locator('.hero-shortcuts [data-open-tool="organize"]').evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(40);
    await page.locator('#tool-search').fill('merge');
    await expect(page.locator('#tool-grid article.tool-card')).toHaveCount(1);
    await page.locator('#tool-grid [data-open-tool="merge"]').click();
    await expect(page.locator('[data-upload-stage]')).toBeVisible();
    expect(await page.locator('[data-select-source]').evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
});
