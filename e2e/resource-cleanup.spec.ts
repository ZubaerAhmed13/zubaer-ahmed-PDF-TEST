import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function previewFixture(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < 12; index += 1) doc.addPage([320 + index, 480 + index]);
  return Buffer.from(await doc.save());
}

test('repeated preview cycles terminate dedicated workers and release canvas DOM resources', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const stats = { created: 0, terminated: 0, active: 0 };
    Object.defineProperty(window, '__docflowWorkerStats', { value: stats, configurable: false });
    class TrackingWorker extends NativeWorker {
      private trackedTerminated = false;
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        stats.created += 1;
        stats.active += 1;
      }
      override terminate(): void {
        if (!this.trackedTerminated) {
          this.trackedTerminated = true;
          stats.terminated += 1;
          stats.active = Math.max(0, stats.active - 1);
        }
        super.terminate();
      }
    }
    Object.defineProperty(window, 'Worker', { value: TrackingWorker, configurable: true, writable: true });
  });

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const fixture = await previewFixture();

  await page.goto('/zubaer-ahmed-PDF-TEST/');
  for (let cycle = 0; cycle < 6; cycle += 1) {
    await page.getByLabel('Search tools').fill('view pdf');
    await page.locator('#tool-grid [data-open-tool="preview"]').click();
    const dialog = page.getByRole('dialog', { name: 'Workspace' });
    await dialog.locator('#workspace-file').setInputFiles({ name: `preview-${cycle}.pdf`, mimeType: 'application/pdf', buffer: fixture });
    await dialog.getByRole('button', { name: 'Run View PDF' }).click();
    await expect(dialog.locator('#stage')).toHaveText('Preview ready');
    await expect(dialog.locator('#viewer-status')).toHaveText('Page 1 of 12');
    await dialog.getByRole('button', { name: 'Next' }).click();
    await expect(dialog.locator('#viewer-status')).toHaveText('Page 2 of 12');
    await dialog.getByRole('button', { name: 'Close workspace' }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => page.evaluate(() => (window as Window & { __docflowWorkerStats?: { active: number } }).__docflowWorkerStats?.active ?? -1)).toBe(0);
    expect(await page.locator('#workspace canvas').count()).toBe(0);
  }

  const stats = await page.evaluate(() => (window as Window & { __docflowWorkerStats?: { created: number; terminated: number; active: number } }).__docflowWorkerStats);
  expect(stats).toBeTruthy();
  expect(stats!.created).toBeGreaterThanOrEqual(6);
  expect(stats!.terminated).toBe(stats!.created);
  expect(stats!.active).toBe(0);
  expect(pageErrors).toEqual([]);
});
