import { expect, test, type Locator, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

const PASSWORD = 'DocFlow-Production-2026!';

async function fixture(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([320, 480]);
  doc.addPage([640, 360]);
  return Buffer.from(await doc.save());
}

async function openLiveApp(page: Page): Promise<void> {
  let loaded = false;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const response = await page.goto('./', { waitUntil: 'domcontentloaded', timeout: 15_000 });
      loaded = Boolean(response?.ok());
      if (loaded) break;
    } catch {
      // GitHub Pages may need a few seconds after deployment before the new artifact is reachable.
    }
    await page.waitForTimeout(5_000);
  }
  expect(loaded).toBe(true);
  await expect(page.getByRole('heading', { name: /Private PDF tools/ })).toBeVisible();

  const manifest = await page.evaluate(async () => {
    const response = await fetch('./manifest.webmanifest', { cache: 'no-store' });
    return { ok: response.ok, value: response.ok ? await response.json() as { start_url?: string; scope?: string } : {} };
  });
  expect(manifest.ok).toBe(true);
  expect(manifest.value.start_url).toBe('./');
  expect(manifest.value.scope).toBe('./');

  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active);
  }, undefined, { timeout: 15_000 });
}

async function openTool(page: Page, query: string, toolId: string): Promise<Locator> {
  await page.getByLabel('Search tools').fill(query);
  await page.locator(`#tool-grid [data-open-tool="${toolId}"]`).click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function download(dialog: Locator, page: Page, name: RegExp): Promise<Buffer> {
  const pending = page.waitForEvent('download');
  await dialog.getByRole('link', { name }).click();
  const item = await pending;
  const path = await item.path();
  if (!path) throw new Error('Production verification did not receive a download path.');
  return readFile(path);
}

test('deployed Pages build executes structural rotation and local AES-256 protection', async ({ page }) => {
  await openLiveApp(page);
  const source = await fixture();
  const appOrigin = new URL(page.url()).origin;
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/^https?:/i.test(url) && new URL(url).origin !== appOrigin) externalRequests.push(url);
  });

  let dialog = await openTool(page, 'rotate', 'rotate');
  await dialog.locator('#workspace-file').setInputFiles({ name: 'production-rotate.pdf', mimeType: 'application/pdf', buffer: source });
  await dialog.locator('select[name="degrees"]').selectOption('90');
  await dialog.getByRole('button', { name: 'Run Rotate pages' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Complete', { timeout: 45_000 });
  const rotatedBytes = await download(dialog, page, /^Download rotated\.pdf/);
  const rotated = await PDFDocument.load(rotatedBytes);
  expect(rotated.getPageCount()).toBe(2);
  expect(rotated.getPages().every((pdfPage) => pdfPage.getRotation().angle === 90)).toBe(true);

  await dialog.getByRole('button', { name: 'Close workspace' }).click();
  await expect(dialog).toBeHidden();

  dialog = await openTool(page, 'protect', 'protect-pdf');
  await dialog.locator('#workspace-file').setInputFiles({ name: 'production-security.pdf', mimeType: 'application/pdf', buffer: source });
  await dialog.locator('#encryption-password').fill(PASSWORD);
  await dialog.locator('#encryption-password-confirm').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Run Protect PDF' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Complete', { timeout: 60_000 });
  await expect(dialog.locator('#encryption-password')).toHaveValue('');
  await expect(dialog.locator('#encryption-password-confirm')).toHaveValue('');

  const protectedBytes = await download(dialog, page, /^Download production-security-protected\.pdf/);
  expect(protectedBytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  expect(protectedBytes.toString('latin1')).toContain('/Encrypt');
  let rejectedWithoutPassword = false;
  try { await PDFDocument.load(protectedBytes); } catch { rejectedWithoutPassword = true; }
  expect(rejectedWithoutPassword).toBe(true);
  expect(externalRequests).toEqual([]);
});
