import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';

test('production worker rejects a broken install and safely forward-recovers a session', async ({ page }) => {
  test.setTimeout(180_000);
  // Isolated HTTP origin; production generator and built application, controlled release markers.
  // This never swaps workers or deployment files on the public host.
  let revision = 'baseline';
  const prefix = '/zubaer-ahmed-PDF-TEST/';
  const dist = resolve('dist');
  const sw = await readFile(resolve(dist, 'sw.js'), 'utf8');
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url!, 'http://localhost').pathname;
      if (!pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
      const local = pathname.slice(prefix.length) || 'index.html';
      const absolute = resolve(dist, local);
      if (!absolute.startsWith(dist + '/')) { response.writeHead(404).end(); return; }
      if (local === '__missing_recovery_fixture__') { response.writeHead(404).end(); return; }
      let body: string | Buffer = await readFile(absolute);
      if (local === 'sw.js') {
        body = sw.replace(/const CACHE_NAME = '[^']+';/, `const CACHE_NAME = 'docflow-static-drill-${revision}';`);
        if (revision === 'broken') body = body.replace("self.addEventListener('install'", "PRECACHE.push('./__missing_recovery_fixture__');\nself.addEventListener('install'");
      }
      if (local === 'index.html') body = body.toString().replace('<body', `<body data-recovery-release="${revision}"`);
      const extension = local.split('.').pop()!;
      const types: Record<string, string> = { html: 'text/html', js: 'application/javascript', mjs: 'application/javascript', css: 'text/css', json: 'application/json', webmanifest: 'application/manifest+json', wasm: 'application/wasm', svg: 'image/svg+xml', png: 'image/png', woff: 'font/woff' };
      response.writeHead(200, { 'Content-Type': types[extension] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(body);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing drill server');
  try {
    await page.goto(`http://127.0.0.1:${address.port}${prefix}`);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await expect(page.locator('body')).toHaveAttribute('data-recovery-release', 'baseline');
    await page.getByRole('button', { name: 'Open a PDF', exact: true }).click();
    const doc = await PDFDocument.create(); doc.addPage([331, 479]); const source = Buffer.from(await doc.save());
    await page.locator('#workspace-file').setInputFiles({ name: 'recovery-safe.pdf', mimeType: 'application/pdf', buffer: source });
    await expect(page.locator('#stage')).toHaveText('Preview ready');
    revision = 'broken';
    const state = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready; await registration.update();
      const worker = registration.installing;
      if (!worker) return 'no-install';
      return new Promise<string>(resolve => {
        const check = () => { if (worker.state === 'redundant' || worker.state === 'installed') resolve(worker.state); };
        worker.addEventListener('statechange', check); check();
      });
    });
    expect(state).toBe('redundant');
    await expect(page.locator('#stage')).toHaveText('Preview ready');
    const downloading = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Export current PDF', exact: true }).click();
    const exported = await downloading; expect(await readFile((await exported.path())!)).toEqual(source);
    // Update controls live outside the modal workspace; closing retains the session.
    await page.getByRole('button', { name: 'Back to all tools', exact: true }).click();
    revision = 'recovered';
    await page.evaluate(async () => { const registration = await navigator.serviceWorker.ready; await registration.update(); });
    await expect(page.locator('[data-apply-update]')).toBeVisible({ timeout: 45000 });
    await page.locator('[data-apply-update]').click();
    const guard = page.getByRole('dialog', { name: 'Clear this tab’s work?' });
    await guard.getByRole('button', { name: 'Keep working', exact: true }).click();
    await page.getByRole('button', { name: 'Resume document', exact: true }).click();
    await expect(page.locator('#stage')).toHaveText('Preview ready');
    await page.getByRole('button', { name: 'Back to all tools', exact: true }).click();
    await page.locator('[data-apply-update]').click();
    await guard.getByRole('button', { name: 'Update and clear session', exact: true }).click();
    await expect(page.locator('body')).toHaveAttribute('data-recovery-release', 'recovered', { timeout: 45000 });
    await expect(page.getByRole('heading', { name: /Your PDFs/ })).toBeVisible();
    await page.locator('#tool-grid [data-open-tool=rotate]').click();
    await page.locator('#workspace-file').setInputFiles({ name: 'retry.pdf', mimeType: 'application/pdf', buffer: source });
    await page.locator('#run-operation').click();
    const result = page.locator('#result a.download').first(); await expect(result).toBeVisible();
    const wait = page.waitForEvent('download'); await result.click(); const file = await wait;
    const reopened = await PDFDocument.load(await readFile((await file.path())!));
    expect(reopened.getPageCount()).toBe(1); expect(reopened.getPage(0).getWidth()).toBe(331);
  } finally {
    await page.goto('about:blank');
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
