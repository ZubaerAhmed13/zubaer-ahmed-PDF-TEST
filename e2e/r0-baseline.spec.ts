import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { tools } from '../src/tools/registry';
import { readFile } from 'node:fs/promises';

test('all 29 tools load their deployed workspaces with no uncaught errors', async ({ page }) => {
  // WebKit on the CI runner takes about five seconds per animated open/close
  // cycle. Budget for all 29 tools while keeping each action bounded.
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  expect(tools).toHaveLength(29);
  await expect(page.locator('#tool-grid .tool-card')).toHaveCount(29);
  for (const tool of tools) {
    await test.step(tool.name, async () => {
      await page.locator('#tool-grid [data-open-tool="' + tool.id + '"]').click({ timeout: 8_000 });
      const dialog = page.getByRole('dialog', { name: 'Workspace' });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('.workspace-loading')).toHaveCount(0);
      await expect(dialog.locator('[data-load-error-for]')).toHaveCount(0);
      await expect(dialog.getByRole('heading', { name: tool.name, exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: 'Close workspace' }).click({ timeout: 8_000 });
      await expect(dialog).toBeHidden();
    });
  }
  expect(errors).toEqual([]);
});

test('diagnostics identifies the running package and build without claiming full PDF support', async ({ page }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await expect(page.locator('.tool-meta').filter({ hasText: 'Migrated' })).toHaveCount(0);
  const packageInfo = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  await page.getByRole('button', { name: 'Diagnostics', exact: true }).first().click();
  const info = page.locator('#info-dialog');
  await expect(info).toContainText(packageInfo.version);
  await expect(info).toContainText('Build');
  if (process.env.GITHUB_SHA) await expect(info).toContainText(process.env.GITHUB_SHA);
});

test('records a reproducible desktop/mobile automation baseline and checks serious accessibility issues', async ({ page, browserName }, testInfo) => {
  const records: unknown[] = [];
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/zubaer-ahmed-PDF-TEST/');
    await expect(page.getByRole('heading', { name: /Private PDF tools/ })).toBeVisible();
    const metrics = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      return {
        userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight],
        domContentLoadedMs: nav?.domContentLoadedEventEnd,
        firstContentfulPaintMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
        horizontalOverflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    expect(metrics.horizontalOverflowPx).toBeLessThanOrEqual(1);
    const accessibility = await new AxeBuilder({ page }).analyze();
    const serious = accessibility.violations.filter(item => ['critical', 'serious'].includes(item.impact ?? ''));
    expect(serious.map(item => item.id)).toEqual([]);
    records.push({ browserName, ...metrics, seriousAccessibilityViolations: serious.length });
  }
  await testInfo.attach('r0-automation-baseline', {
    body: JSON.stringify({
      note: 'Two viewport samples on the CI machine, unthrottled. Not physical-device, manual WCAG, LCP/INP or field-performance certification.',
      build: process.env.GITHUB_SHA ?? 'local', records
    }, null, 2),
    contentType: 'application/json'
  });
});
