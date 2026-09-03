import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function previewFixture(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < 16; index += 1) doc.addPage([420 + (index % 3) * 12, 595 + (index % 5) * 10]);
  return Buffer.from(await doc.save());
}

async function previewCycle(page: import('@playwright/test').Page, fixture: Buffer, cycle: number): Promise<void> {
  await page.getByLabel('Search tools').fill('view pdf');
  await page.locator('#tool-grid [data-open-tool="preview"]').click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await dialog.locator('#workspace-file').setInputFiles({ name: `heap-${cycle}.pdf`, mimeType: 'application/pdf', buffer: fixture });
  await dialog.getByRole('button', { name: 'Run View PDF' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Preview ready');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.locator('#viewer-status')).toHaveText('Page 2 of 16');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.locator('#viewer-status')).toHaveText('Page 3 of 16');
  await dialog.getByRole('button', { name: 'Close workspace' }).click();
  await expect(dialog).toBeHidden();
}

test('Chromium heap remains bounded after repeated preview open/render/close cycles', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Precise forced-GC heap evidence uses Chromium DevTools Protocol.');
  test.setTimeout(90_000);

  const fixture = await previewFixture();
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  const session = await context.newCDPSession(page);
  await session.send('HeapProfiler.enable');

  // Warm caches, PDF.js modules, fonts and the worker path before taking the baseline.
  await previewCycle(page, fixture, -1);
  await session.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(100);
  const baseline = await session.send('Runtime.getHeapUsage') as { usedSize: number; totalSize: number };

  const settled: number[] = [];
  for (let cycle = 0; cycle < 8; cycle += 1) {
    await previewCycle(page, fixture, cycle);
    await session.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(75);
    const heap = await session.send('Runtime.getHeapUsage') as { usedSize: number; totalSize: number };
    settled.push(heap.usedSize);
  }

  const finalUsed = settled.at(-1)!;
  const tail = settled.slice(-3);
  const tailSpread = Math.max(...tail) - Math.min(...tail);
  const allowedGrowth = Math.max(12 * 1024 * 1024, baseline.usedSize * 0.45);

  expect(finalUsed - baseline.usedSize, `baseline=${baseline.usedSize}, samples=${settled.join(',')}`).toBeLessThanOrEqual(allowedGrowth);
  expect(tailSpread, `tail samples did not settle: ${tail.join(',')}`).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(await page.locator('#workspace canvas').count()).toBe(0);

  await session.send('HeapProfiler.disable');
});
