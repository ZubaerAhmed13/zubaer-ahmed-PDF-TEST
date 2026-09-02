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

test('certifies offline app availability and local processing where the browser harness permits', async ({ page, context, browserName }) => {
  const appPath = '/zubaer-ahmed-PDF-TEST/';
  await page.goto(appPath);
  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active);
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  if (browserName === 'webkit') {
    // Playwright WebKit 26.5 applies its offline shim before service-worker handling for
    // navigation/fetch/new Worker requests. That makes a true offline reload or a newly
    // created worker impossible to exercise through this harness even when those assets
    // are present in Cache Storage. Certify the generated precache while the context is
    // genuinely offline. The separate worker-backed merge test above still certifies the
    // WebKit processing path; Chromium and Firefox exercise the full offline reload+merge.
    await context.setOffline(true);
    const cachedApp = await page.evaluate(async () => {
      const cacheNames = await caches.keys();
      const cacheName = cacheNames.find((name) => name.startsWith('docflow-static-'));
      if (!cacheName) return { shellFound: false, shellText: '', jsCount: 0 };
      const cache = await caches.open(cacheName);
      const requests = await cache.keys();
      const shellRequest = requests.find((request) => {
        const url = new URL(request.url);
        return url.pathname.endsWith('/zubaer-ahmed-PDF-TEST/');
      });
      const jsCount = requests.filter((request) => new URL(request.url).pathname.endsWith('.js')).length;
      const response = shellRequest ? await cache.match(shellRequest) : undefined;
      return { shellFound: Boolean(response), shellText: response ? await response.text() : '', jsCount };
    });
    expect(cachedApp.shellFound).toBe(true);
    expect(cachedApp.shellText).toContain('<div id="app"></div>');
    expect(cachedApp.jsCount).toBeGreaterThan(1);
    await context.setOffline(false);
    return;
  }

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: /Private PDF tools/ })).toBeVisible();
  await page.getByLabel('Search tools').fill('merge');
  await page.getByRole('button', { name: 'Open tool' }).click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  await dialog.locator('#workspace-file').setInputFiles([
    { name: 'offline-one.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(1) },
    { name: 'offline-two.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(2) }
  ]);
  await dialog.getByRole('button', { name: 'Run Merge PDF' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Complete');
  await expect(dialog.getByRole('link', { name: /Download merged\.pdf/ })).toBeVisible();
  await context.setOffline(false);
});

test('responsive shell and workspace avoid horizontal overflow at target widths', async ({ page }) => {
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/zubaer-ahmed-PDF-TEST/');
    await expect(page.getByRole('heading', { name: /Private PDF tools/ })).toBeVisible();
    const shellOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(shellOverflow).toBeLessThanOrEqual(1);

    await page.getByLabel('Search tools').fill('merge');
    await page.getByRole('button', { name: 'Open tool' }).click();
    const dialog = page.getByRole('dialog', { name: 'Workspace' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.drop-zone')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Run Merge PDF' })).toBeVisible();
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0)).toBeLessThanOrEqual(width + 1);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }
});
