import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

const PASSWORD = 'DocFlow-AES256-2026!';

async function pdfFixture(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([320, 480]);
  doc.addPage([640, 360]);
  return Buffer.from(await doc.save());
}

async function waitForControlledServiceWorker(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active);
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
}

test('protects with AES-256, rejects a wrong password, and unlocks to a reopenable PDF', async ({ page }) => {
  const source = await pdfFixture();
  const externalRequests: string[] = [];
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  const appOrigin = new URL(page.url()).origin;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== appOrigin) externalRequests.push(request.url());
  });

  await page.getByLabel('Search tools').fill('protect');
  await page.locator('#tool-grid [data-open-tool="protect-pdf"]').click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  await dialog.locator('#workspace-file').setInputFiles({ name: 'security-fixture.pdf', mimeType: 'application/pdf', buffer: source });
  await expect(dialog.getByText('security-fixture.pdf')).toBeVisible();
  await dialog.locator('#encryption-password').fill(PASSWORD);
  await dialog.locator('#encryption-password-confirm').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Run Protect PDF' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Complete', { timeout: 60_000 });
  await expect(dialog.locator('#encryption-password')).toHaveValue('');
  await expect(dialog.locator('#encryption-password-confirm')).toHaveValue('');

  const protectedDownload = page.waitForEvent('download');
  await dialog.getByRole('link', { name: /Download security-fixture-protected\.pdf/ }).click();
  const protectedPath = await (await protectedDownload).path();
  if (!protectedPath) throw new Error('Playwright did not expose the protected PDF download path.');
  const protectedBytes = await readFile(protectedPath);
  expect(protectedBytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  expect(protectedBytes.toString('latin1')).toContain('/Encrypt');
  let encryptedRejected = false;
  try { await PDFDocument.load(protectedBytes); } catch { encryptedRejected = true; }
  expect(encryptedRejected).toBe(true);

  const persistedSecret = await page.evaluate(async (secret) => {
    const localValues = Object.entries(localStorage).map(([key, value]) => `${key}:${value}`).join('\n');
    const indexedValue = await new Promise<string>((resolve) => {
      const request = indexedDB.open('docflow-project-state');
      request.onerror = () => resolve('');
      request.onupgradeneeded = () => {
        request.transaction?.abort();
        resolve('');
      };
      request.onsuccess = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('snapshots')) {
          database.close();
          resolve('');
          return;
        }
        const transaction = database.transaction('snapshots', 'readonly');
        const get = transaction.objectStore('snapshots').get('last');
        get.onerror = () => { database.close(); resolve(''); };
        get.onsuccess = () => { const value = JSON.stringify(get.result ?? ''); database.close(); resolve(value); };
      };
    });
    return `${localValues}\n${indexedValue}`.includes(secret);
  }, PASSWORD);
  expect(persistedSecret).toBe(false);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByLabel('Search tools').fill('unlock');
  await page.locator('#tool-grid [data-open-tool="unlock-pdf"]').click();
  await expect(dialog).toBeVisible();
  await dialog.locator('#workspace-file').setInputFiles({ name: 'protected.pdf', mimeType: 'application/pdf', buffer: protectedBytes });

  await dialog.locator('#encryption-password').fill('wrong-password');
  await dialog.getByRole('button', { name: 'Run Unlock PDF' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Failed', { timeout: 60_000 });
  await expect(dialog.locator('#error')).toContainText('INVALID_PASSWORD');
  await expect(dialog.locator('#encryption-password')).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Run Unlock PDF' })).toBeEnabled();

  await dialog.locator('#encryption-password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Run Unlock PDF' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Complete', { timeout: 60_000 });
  const unlockedDownload = page.waitForEvent('download');
  await dialog.getByRole('link', { name: /Download protected-unlocked\.pdf/ }).click();
  const unlockedPath = await (await unlockedDownload).path();
  if (!unlockedPath) throw new Error('Playwright did not expose the unlocked PDF download path.');
  const unlockedBytes = await readFile(unlockedPath);
  expect(unlockedBytes.toString('latin1')).not.toContain('/Encrypt');
  const reopened = await PDFDocument.load(unlockedBytes);
  expect(reopened.getPageCount()).toBe(2);
  expect(reopened.getPages().map((pdfPage) => [pdfPage.getWidth(), pdfPage.getHeight()])).toEqual([[320, 480], [640, 360]]);
  expect(externalRequests).toEqual([]);
});

test('certifies offline encryption execution or qpdf precache coverage', async ({ page, context, browserName }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await waitForControlledServiceWorker(page);

  if (browserName === 'webkit') {
    // Playwright WebKit 26.5 blocks newly created workers after its forced-offline shim is enabled,
    // before a controlling service worker can answer the worker request. Verify the exact qpdf
    // runtime and lazy security workspace are already in Cache Storage while genuinely offline;
    // the normal WebKit test above separately executes the qpdf worker end to end.
    await context.setOffline(true);
    try {
      const cached = await page.evaluate(async () => {
        const cacheName = (await caches.keys()).find((name) => name.startsWith('docflow-static-'));
        if (!cacheName) return { wasm: false, worker: false, workspace: false };
        const cache = await caches.open(cacheName);
        const paths = (await cache.keys()).map((request) => new URL(request.url).pathname);
        return {
          wasm: paths.some((path) => /\/assets\/qpdf-[^/]+\.wasm$/.test(path)),
          worker: paths.some((path) => /\/assets\/qpdf\.worker-[^/]+\.js$/.test(path)),
          workspace: paths.some((path) => /\/assets\/encryptionWorkspace-[^/]+\.js$/.test(path))
        };
      });
      expect(cached).toEqual({ wasm: true, worker: true, workspace: true });
    } finally {
      await context.setOffline(false);
    }
    return;
  }

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByRole('heading', { name: /Private PDF tools/ })).toBeVisible();
    await page.getByLabel('Search tools').fill('protect');
    await page.locator('#tool-grid [data-open-tool="protect-pdf"]').click();
    const dialog = page.getByRole('dialog', { name: 'Workspace' });
    await expect(dialog).toBeVisible();
    await dialog.locator('#workspace-file').setInputFiles({ name: 'offline-security.pdf', mimeType: 'application/pdf', buffer: await pdfFixture() });
    await dialog.locator('#encryption-password').fill(PASSWORD);
    await dialog.locator('#encryption-password-confirm').fill(PASSWORD);
    await dialog.getByRole('button', { name: 'Run Protect PDF' }).click();
    await expect(dialog.locator('#stage')).toHaveText('Complete', { timeout: 60_000 });

    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('link', { name: /Download offline-security-protected\.pdf/ }).click();
    const path = await (await downloadPromise).path();
    if (!path) throw new Error('Playwright did not expose the offline protected PDF path.');
    const bytes = await readFile(path);
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(bytes.toString('latin1')).toContain('/Encrypt');
  } finally {
    await context.setOffline(false);
  }
});
