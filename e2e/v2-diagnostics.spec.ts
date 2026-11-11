import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

const base = '/zubaer-ahmed-PDF-TEST/';

test('phone diagnostics require fresh review and download only the previewed local report', async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 820 });
  await page.goto(base + '#/tools/rotate');
  const pdf = await PDFDocument.create();
  pdf.addPage([400, 580]).drawText('PRIVATE-DOC-TEXT');
  await page.locator('[data-file-input]').setInputFiles({
    name: 'private-source.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.locator('[data-render-status]')).toHaveText('Page 1 of 1');
  await page.evaluate(() => localStorage.setItem('docflow-test-private-fixture', 'PRIVATE-ACCOUNT-STATE'));
  const writes: string[] = [];
  page.on('request', item => { if (!['GET', 'HEAD'].includes(item.method())) writes.push(item.url()); });

  const trigger = page.getByRole('button', { name: 'Offline and storage' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Offline and storage' });
  await dialog.getByText('Diagnostics report', { exact: true }).click();
  const preview = dialog.getByLabel('Report preview');
  const release = await (await request.get(base + 'release.json')).json();
  expect(JSON.parse(await preview.inputValue()).release).toEqual({ version: release.version, build: release.build });
  const download = dialog.getByRole('button', { name: 'Download diagnostics' });
  const reviewed = dialog.getByLabel('I reviewed this report and want to download it');
  await expect(download).toBeDisabled();
  await reviewed.check();
  await expect(download).toBeEnabled();
  await dialog.getByLabel('Version and build', { exact: true }).uncheck();
  await expect(download).toBeDisabled();
  const report = await preview.inputValue();
  expect(JSON.parse(report)).toEqual({ format: 'docflow-diagnostics', schema: 1, environment: {
    online: expect.any(Boolean), workers: expect.any(Boolean), serviceWorker: expect.any(Boolean),
    controlled: expect.any(Boolean), cacheStorage: expect.any(Boolean), indexedDB: expect.any(Boolean),
  } });
  expect(report).not.toMatch(/PRIVATE|private-source|password|token|userAgent|url/i);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  const audit = await new AxeBuilder({ page }).include('dialog[open]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  expect(audit.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) }))).toEqual([]);

  await reviewed.check();
  const pending = page.waitForEvent('download');
  await download.click();
  const file = await pending;
  expect(file.suggestedFilename()).toBe('docflow-diagnostics.json');
  expect(await readFile((await file.path())!, 'utf8')).toBe(report);
  expect(writes).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page.locator('.df2-file')).toContainText('private-source.pdf');
});
