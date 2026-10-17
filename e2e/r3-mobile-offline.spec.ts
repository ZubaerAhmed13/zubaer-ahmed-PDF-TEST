import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';

const app = '/zubaer-ahmed-PDF-TEST/';
test.use({ actionTimeout: 12_000 });
async function fixture(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([420, 600]).drawText('OFFLINE SOURCE', { x: 40, y: 500, size: 20 });
  return Buffer.from(await doc.save());
}
async function start(page: Page): Promise<void> {
  await page.goto(app);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), undefined, { timeout: 30_000 });
}
async function disconnect(page: Page, context: BrowserContext): Promise<void> {
  await context.setOffline(true);
  // Network emulation does not consistently update navigator.onLine in every engine.
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
}
async function verifyWebKitStorageOffline(page: Page, context: BrowserContext, group: 'core' | 'eng'): Promise<void> {
  test.info().annotations.push({ type: 'verification-scope', description: 'WebKit: real offline CacheStorage integrity plus online PDF execution. The automation runtime blocks offline reload/new-worker creation; Safari offline execution remains unverified.' });
  const manifest = await page.evaluate(async () => await (await fetch('./offline-manifest.json')).json() as {
    coreCache: string; ocrCache: string; groups: Record<string, {path: string; bytes: number; sha256: string}[]>;
  });
  await context.setOffline(true);
  try {
    const evidence = await page.evaluate(async ({ manifest, group }) => {
      const cache = await caches.open(group === 'core' ? manifest.coreCache : manifest.ocrCache);
      const invalid: string[] = [];
      for (const asset of manifest.groups[group]!) {
        const response = await cache.match(new URL(asset.path, location.href).href, { ignoreVary: true });
        if (!response?.ok) { invalid.push(asset.path); continue; }
        const bytes = await response.arrayBuffer();
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
        if (bytes.byteLength !== asset.bytes || hash !== asset.sha256) invalid.push(asset.path);
      }
      const shell = await (await caches.open(manifest.coreCache)).match(new URL('./', location.href).href, { ignoreVary: true });
      return { count: manifest.groups[group]!.length, invalid, shell: (await shell?.text())?.includes('<div id="app"></div>') };
    }, { manifest, group });
    expect(evidence.count).toBeGreaterThan(0); expect(evidence.invalid).toEqual([]); expect(evidence.shell).toBe(true);
  } finally { await context.setOffline(false); }
}
async function offlinePanel(page: Page): Promise<void> {
  await page.locator('footer [data-action="offline"]').click();
  await expect(page.locator('[data-offline-state="core"]')).toContainText('Ready in this browser', { timeout: 30_000 });
}
async function open(page: Page, tool: string): Promise<void> {
  await page.locator(`#tool-grid [data-open-tool="${tool}"]`).click();
  await expect(page.getByRole('dialog', { name: 'Workspace', exact: true })).toBeVisible();
}
async function exported(page: Page, name: string | RegExp): Promise<Buffer> {
  const pending = page.waitForEvent('download');
  await page.getByRole('link', { name, exact: typeof name === 'string' }).click();
  const path = await (await pending).path();
  if (!path) throw Error('Missing exported file');
  return readFile(path);
}
async function scanned(page: Page): Promise<Buffer> {
  const image = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1000; c.height = 320;
    const ctx = c.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = 'black'; ctx.font = 'bold 90px Arial'; ctx.fillText('DOCFLOW OFFLINE TEST', 30, 180);
    return c.toDataURL('image/png').split(',')[1]!;
  });
  const doc = await PDFDocument.create();
  const png = await doc.embedPng(Buffer.from(image, 'base64'));
  doc.addPage([500, 160]).drawImage(png, { x: 0, y: 0, width: 500, height: 160 });
  return Buffer.from(await doc.save());
}

test('prepared mobile core edits and exports with offline Chromium/Firefox and scoped WebKit storage checks', async ({ page, context, browserName }, info) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page); await offlinePanel(page);
  await expect(page.locator('[data-offline-state="eng"]')).toContainText('missing');
  await page.getByRole('dialog', { name: 'Offline and storage' }).getByRole('button', { name: 'Close', exact: true }).click();
  if (browserName === 'webkit') await verifyWebKitStorageOffline(page, context, 'core');
  else {
    await disconnect(page, context);
    await page.reload();
    expect(await page.evaluate(async () => { try { await fetch('./offline-probe?test=' + Date.now(), { cache: 'no-store' }); return false; } catch { return true; } })).toBe(true);
  }
  await expect(page.getByRole('heading', { name: /Private PDF tools/ })).toBeVisible();
  await open(page, 'edit-pdf');
  await page.locator('#workspace-file').setInputFiles({ name: 'mobile.pdf', mimeType: 'application/pdf', buffer: await fixture() });
  await expect(page.locator('#stage')).toContainText('Editing page 1');
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false);
  await page.getByRole('button', { name: 'Help & offline', exact: true }).click();
  if (browserName !== 'webkit') await expect(page.locator('[data-network]')).toContainText('offline');
  await page.getByRole('dialog', { name: 'Offline and storage' }).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('#stage')).toContainText('Editing page 1');
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await page.getByRole('button', { name: 'Object properties', exact: true }).click();
  await page.locator('[data-properties] textarea').fill('Offline Grüße');
  await page.getByRole('button', { name: 'Apply properties', exact: true }).click();
  const x = Number(await page.locator('[data-properties] [name=x]').inputValue());
  await page.getByRole('button', { name: 'Move right', exact: true }).click();
  await expect(page.locator('[data-properties] [name=x]')).toHaveValue(String(x + 5));
  await page.getByRole('button', { name: 'Pan page', exact: true }).click();
  await expect(page.locator('.direct-overlay')).toHaveAttribute('data-pan', 'true');
  const touchAction = await page.locator('.direct-overlay').evaluate(el => getComputedStyle(el).touchAction);
  expect(touchAction === 'manipulation' || touchAction.includes('pinch-zoom')).toBe(true);
  await page.getByRole('button', { name: 'Run Edit PDF', exact: true }).click();
  await expect(page.locator('#stage')).toContainText('Edits ready');
  const bytes = await exported(page, 'Download edited PDF');
  const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const text = (await (await pdf.getPage(1)).getTextContent()).items.map(i => 'str' in i ? i.str : '').join(' ');
  expect(text).toContain('Offline Grüße'); await pdf.destroy();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const axe = await new AxeBuilder({ page }).include('.direct-editor').analyze();
  expect(axe.violations.filter(v => ['critical', 'serious'].includes(v.impact ?? '')).map(v => v.id)).toEqual([]);
  await info.attach('mobile-offline-export', { body: await page.screenshot(), contentType: 'image/png' });
  await context.setOffline(false);
});

test('prepared OCR reopens scanned output and detects eviction, offline in Chromium/Firefox and storage-scoped in WebKit', async ({ page, context, browserName }) => {
  test.setTimeout(180_000);
  await start(page); const scan = await scanned(page); await offlinePanel(page);
  await page.getByRole('button', { name: 'Prepare English OCR', exact: true }).click();
  await expect(page.locator('[data-offline-state="eng"]')).toHaveText('Ready in this browser', { timeout: 90_000 });
  await expect(page.locator('[data-offline-state="deu"]')).toContainText('missing');
  // Static prepared bytes must not become unreachable when request headers differ from the preparation request.
  // Pages uses Vary: Accept-Encoding; a controllable Vary header reproduces the Cache API boundary here.
  await page.evaluate(async () => {
    const m = await (await fetch('./offline-manifest.json')).json();
    const cache = await caches.open(m.ocrCache), url = new URL('./ocr/worker.min.js', location.href).href;
    const response = (await cache.match(url))!;
    const headers = new Headers(response.headers);
    headers.set('Vary', 'X-DocFlow-Variant'); headers.delete('Content-Encoding'); headers.delete('Content-Length');
    const body = await response.arrayBuffer(); await cache.delete(url);
    await cache.put(new Request(url, { headers: { 'X-DocFlow-Variant': 'prepared' } }), new Response(body, { headers }));
  });
  await page.getByRole('dialog', { name: 'Offline and storage' }).getByRole('button', { name: 'Close', exact: true }).click();
  if (browserName === 'webkit') await verifyWebKitStorageOffline(page, context, 'eng');
  else { await disconnect(page, context); await page.reload(); }
  await open(page, 'ocr');
  await page.locator('#workspace-file').setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: scan });
  await page.getByRole('button', { name: 'Run OCR scanned PDF', exact: true }).click();
  await expect(page.locator('#stage')).toContainText('OCR complete', { timeout: 90_000 });
  const bytes = await exported(page, /^Download searchable-ocr\.pdf/);
  const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const text = (await (await pdf.getPage(1)).getTextContent()).items.map(i => 'str' in i ? i.str : '').join(' ');
  expect(text.toUpperCase()).toContain('OFFLINE'); await pdf.destroy();
  // Remove the real prepared model. Readiness and OCR must now fail honestly, even if Tesseract has an IDB copy.
  await page.evaluate(async () => {
    const m = await (await fetch('./offline-manifest.json')).json();
    await (await caches.open(m.ocrCache)).delete(new URL('./ocr/lang/eng.traineddata', location.href).href);
  });
  if (browserName === 'webkit') await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
  await page.getByRole('button', { name: 'Run OCR scanned PDF', exact: true }).click();
  await expect(page.locator('#error')).toContainText('Offline OCR assets are missing');
  await expect(page.locator('#run-operation')).toBeEnabled();
  await context.setOffline(false);
});

test('system sharing keeps user activation, shares exact export bytes, and retains download after cancellation', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => {
      const file = data.files![0]!;
      document.documentElement.dataset.shareGesture = String(navigator.userActivation.isActive);
      document.documentElement.dataset.shareName = file.name;
      document.documentElement.dataset.shareBytes = String(file.size);
      document.documentElement.dataset.shareHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('');
      throw new DOMException('Cancelled', 'AbortError');
    } });
  });
  await start(page); await open(page, 'edit-pdf');
  await page.locator('#workspace-file').setInputFiles({ name: 'share.pdf', mimeType: 'application/pdf', buffer: await fixture() });
  await expect(page.locator('#stage')).toContainText('Editing page 1');
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await page.getByRole('button', { name: 'Run Edit PDF', exact: true }).click();
  await expect(page.locator('#stage')).toContainText('Edits ready');
  await page.getByRole('button', { name: 'Save / share edited.pdf', exact: true }).click();
  await expect(page.locator('.file-share-status')).toContainText('Sharing cancelled');
  await expect(page.locator('html')).toHaveAttribute('data-share-gesture', 'true');
  const bytes = await exported(page, 'Download edited PDF');
  await expect(page.locator('html')).toHaveAttribute('data-share-bytes', String(bytes.length));
  await expect(page.locator('html')).toHaveAttribute('data-share-hash', createHash('sha256').update(bytes).digest('hex'));
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
});

test('cancelled pointer movement restores its starting geometry and keyboard properties remain reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await start(page); await open(page, 'edit-pdf');
  await page.locator('#workspace-file').setInputFiles({ name: 'cancel.pdf', mimeType: 'application/pdf', buffer: await fixture() });
  await expect(page.locator('#stage')).toContainText('Editing page 1');
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await page.getByRole('button', { name: 'Select objects', exact: true }).click();
  const object = page.locator('[data-object]'); await object.scrollIntoViewIfNeeded();
  const initial = await object.getAttribute('style');
  const rect = await object.boundingBox(); if (!rect) throw Error('Missing object');
  await page.mouse.move(rect.x + 4, rect.y + 4); await page.mouse.down(); await page.mouse.move(rect.x + 30, rect.y + 20);
  await page.locator('.direct-overlay').dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  expect(await object.getAttribute('style')).toBe(initial);
  await page.getByRole('button', { name: 'Object properties', exact: true }).click();
  await expect(page.locator('.direct-inspector summary')).toBeFocused();
  await page.setViewportSize({ width: 640, height: 390 });
  expect((await page.locator('#workspace-dialog').boundingBox())!.height).toBeLessThanOrEqual(390);
});


test('same-named batch inputs retain distinct downloads, sharing bytes and ZIP entries', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => {
      const bytes = await data.files![0]!.arrayBuffer();
      document.documentElement.dataset.batchShareHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    } });
  });
  const first = await fixture(), other = await PDFDocument.create();
  other.addPage([500, 700]); other.addPage([500, 700]);
  await start(page); await open(page, 'batch');
  await page.locator('#batch-files').setInputFiles([
    { name: 'same.pdf', mimeType: 'application/pdf', buffer: first },
    { name: 'same.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await other.save()) }
  ]);
  await expect(page.locator('.batch-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Run batch', exact: true }).click();
  await expect(page.locator('#batch-stage')).toHaveText('Batch complete · 2 of 2 succeeded');
  const names = await page.locator('#batch-results a[download]').evaluateAll(links => links.map(a => (a as HTMLAnchorElement).download));
  expect(names).toEqual(['same-rotated.pdf', 'same-rotated-2.pdf']);
  const bytes = await exported(page, /^Download same-rotated-2\.pdf/);
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  await page.getByRole('button', { name: 'Save / share same-rotated-2.pdf', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-batch-share-hash', createHash('sha256').update(bytes).digest('hex'));
  await page.getByRole('button', { name: 'Prepare ZIP', exact: true }).click();
  await expect(page.locator('#batch-stage')).toHaveText('ZIP ready · 2 outputs');
  const archive = await JSZip.loadAsync(await exported(page, /^Download docflow-batch-results\.zip/));
  expect(Object.keys(archive.files).sort()).toEqual([...names].sort());
  expect((await PDFDocument.load(await archive.file(names[1]!)!.async('uint8array'))).getPageCount()).toBe(2);
});
