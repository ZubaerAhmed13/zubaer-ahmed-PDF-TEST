import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';

const app = '/zubaer-ahmed-PDF-TEST/';
test('practical task discovery, unsupported searches and capability limits stay truthful', async ({ page }) => {
  await page.goto(app);
  await expect(page.getByRole('heading', { name: 'Start with what you need to do' })).toBeVisible();
  await expect(page.locator('[data-example-tool]')).toHaveCount(4);
  await page.getByLabel('Search tools').fill('make pdf smaller');
  await expect(page.locator('#tool-grid [data-tool=compress]')).toBeVisible();
  await page.getByLabel('Search tools').fill('word to pdf');
  await expect(page.getByText('No tools found', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset search and category' }).click();
  await expect(page.locator('#tool-grid .tool-card')).toHaveCount(29);
  await page.getByRole('button', { name: 'Help & capabilities', exact: true }).click();
  const info = page.locator('#info-dialog');
  await info.getByLabel('Find a tool or task').fill('black out confidential');
  await info.locator('[data-help-results] summary').click();
  await expect(info.locator('.product-limit')).toContainText('all original text');
  await info.getByRole('button', { name: 'Open Permanent redaction', exact: true }).click();
  await expect(page.locator('#workspace-dialog')).toBeVisible();
  await expect(page.locator('#workspace')).toContainText('Permanent redaction');
});

test('diagnostics downloads only the reviewed redacted preview and sends nothing', async ({ page }) => {
  await page.goto(app);
  const posts: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET') posts.push(request.url()); });
  await page.evaluate(() => localStorage.setItem('diagnostic-private-fixture', 'SECRET-ACCOUNT-TOKEN'));
  await page.getByRole('button', { name: 'Diagnostics', exact: true }).first().click();
  const info = page.locator('#info-dialog');
  const download = info.getByRole('button', { name: 'Download diagnostics' });
  await expect(download).toBeDisabled();
  await info.getByLabel('I reviewed this report and want to download it').check();
  await expect(download).toBeEnabled();
  await info.getByLabel('Version and build', { exact: true }).uncheck();
  await expect(download).toBeDisabled();
  const report = await info.getByLabel('Report preview').inputValue();
  expect(JSON.parse(report).release).toBeUndefined();
  expect(report).not.toMatch(/SECRET|filename|password|token|userAgent|settings|url|logs/i);
  await info.getByLabel('I reviewed this report and want to download it').check();
  const wait = page.waitForEvent('download'); await download.click();
  const file = await wait;
  expect(file.suggestedFilename()).toBe('docflow-diagnostics.json');
  expect(await readFile((await file.path())!, 'utf8')).toBe(report);
  expect(posts).toEqual([]);
  await info.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Diagnostics', exact: true }).first().click();
  await expect(download).toBeDisabled();
});

test('workspace finder preserves the captured document on dismissal and exports it', async ({ page }) => {
  await page.goto(app);
  await page.locator('#tool-grid [data-open-tool=rotate]').click();
  const workspace = page.locator('#workspace-dialog');
  const doc = await PDFDocument.create(); doc.addPage([317, 463]);
  await workspace.locator('#workspace-file').setInputFiles({ name: 'private-source.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  // The finder is an actual control in the legacy header and the native toolbar.
  await workspace.getByRole('button', { name: 'Find tools and help', exact: true }).last().click();
  const info = page.locator('#info-dialog');
  await info.getByLabel('Find a tool or task').fill('rotate pages');
  await expect(info.locator('[data-help-count]')).toContainText('tools');
  await page.keyboard.press('Escape');
  await expect(workspace.locator('#file-list')).toContainText('private-source.pdf');
  await workspace.locator('#run-operation').click();
  const link = workspace.locator('#result a.download').first();
  await expect(link).toBeVisible();
  const wait = page.waitForEvent('download'); await link.click();
  const file = await wait; const output = await PDFDocument.load(await readFile((await file.path())!));
  expect(output.getPageCount()).toBe(1); expect(output.getPage(0).getWidth()).toBe(317);
});

test('finder tool handoff respects unapplied session changes and preserves the working PDF', async ({ page }) => {
  await page.goto(app);
  await page.getByRole('button', { name: 'Open a PDF', exact: true }).click();
  const workspace = page.locator('#workspace-dialog');
  const doc = await PDFDocument.create(); doc.addPage([319, 467]);
  await workspace.locator('#workspace-file').setInputFiles({ name: 'session-private.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(workspace.locator('#stage')).toHaveText('Preview ready');
  await workspace.getByRole('combobox', { name: 'Next tool', exact: true }).selectOption('rotate');
  await workspace.locator('select[name=degrees]').selectOption('180');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  const info = page.locator('#info-dialog');
  await info.getByLabel('Find a tool or task').fill('page numbers');
  await info.locator('[data-help-results] summary').click();
  await info.getByRole('button', { name: 'Open Add page numbers', exact: true }).click();
  const guard = page.getByRole('dialog', { name: 'Leave unapplied tool changes?' });
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: 'Keep working', exact: true }).click();
  await expect(workspace.locator('select[name=degrees]')).toHaveValue('180');
  await expect(workspace.locator('#file-list')).toContainText('session-private.pdf');
});

test('local data controls clear only chosen local state and handle denied storage', async ({ page }) => {
  await page.goto(app);
  await page.locator('[data-favorite=merge]').click();
  await page.evaluate(() => localStorage.setItem('docflow.workflow-recipes.v1', 'KEEP-RECIPE'));
  await page.getByRole('button', { name: 'Privacy', exact: true }).first().click();
  const info = page.locator('#info-dialog');
  await info.getByRole('button', { name: 'Clear local favourites and recent tools' }).click();
  await expect(info.locator('[data-privacy-status]')).toContainText('cleared');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('docflow.favorites.v1')!))).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('docflow.workflow-recipes.v1'))).toBe('KEEP-RECIPE');
  await info.getByRole('button', { name: 'Clear saved recovery metadata' }).click();
  await expect(info.locator('[data-privacy-status]')).toContainText('Saved recovery metadata cleared');
  await page.evaluate(() => { Storage.prototype.removeItem = () => { throw new DOMException('denied', 'SecurityError'); }; });
  await info.getByRole('button', { name: 'Clear local favourites and recent tools' }).click();
  await expect(info.locator('[data-privacy-status]')).toContainText('denied');
});

test('help and diagnostics remain accessible at narrow width with reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(app);
  // Footer help remains visible when mobile navigation is collapsed.
  await page.getByRole('button', { name: 'Help & release notes', exact: true }).click();
  const info = page.locator('#info-dialog');
  await expect(info.getByLabel('Find a tool or task')).toBeFocused();
  await info.getByLabel('Find a tool or task').fill('forms');
  await expect(info.locator('[data-help-results]')).toContainText('Fill PDF forms');
  expect(await info.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  const helpAxe = await new AxeBuilder({ page }).include('#info-dialog').analyze();
  expect(helpAxe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Diagnostics', exact: true }).last().click();
  const diagnosticAxe = await new AxeBuilder({ page }).include('#info-dialog').analyze();
  expect(diagnosticAxe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  expect(await info.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
});

test('published release identity agrees with running diagnostics', async ({ page }) => {
  await page.goto(app);
  const metadata = await page.evaluate(async () => (await fetch('./release.json', { cache: 'no-store' })).json());
  expect(metadata).toMatchObject({ format: 'docflow-release', schema: 1, version: '0.9.0' });
  await page.getByRole('button', { name: 'Diagnostics', exact: true }).first().click();
  const report = JSON.parse(await page.getByLabel('Report preview').inputValue());
  expect(report.release).toEqual({ version: metadata.version, build: metadata.build });
});
