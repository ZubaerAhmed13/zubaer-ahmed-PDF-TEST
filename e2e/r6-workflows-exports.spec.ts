import { returnToEditor } from './helpers/editorReturn';
import { test, expect, type Page, type Locator } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';

async function sample(name = 'source.pdf', count = 3) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) doc.addPage([400 + i, 600]).drawText('Original page ' + (i + 1), { x: 40, y: 450 });
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
}
async function open(page: Page, id = 'workflow') {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.locator('#tool-grid [data-open-tool="' + id + '"]').click();
  const dialog = page.getByRole('region', { name: 'Workspace', exact: true });
  await expect(dialog).toBeVisible(); if (id === 'workflow') await dialog.getByRole('button', { name: 'Manage workflow recipes', exact: true }).click(); return dialog;
}
async function bytes(page: Page, link: Locator) {
  await returnToEditor(page);
  const wait = page.waitForEvent('download'); await link.click();
  const file = await wait; return readFile((await file.path())!);
}
test('portable recipe, dry run and page-relative export survive a local round trip', async ({ page }) => {
  const dialog = await open(page);
  await dialog.locator('#wf-name').fill('My repeat recipe');
  const exported = await bytes(page, dialog.getByRole('link', { name: 'Export recipe' }));
  const json = JSON.parse(exported.toString());
  expect(json).toMatchObject({ format: 'docflow-workflow', version: 1 });
  json.recipe.steps = [
    { id: 'remove', operation: 'remove-pages', options: { pages: '1' } },
    { id: 'keep', operation: 'extract-pages', options: { pages: '2' } }
  ];
  await dialog.getByLabel('Import recipe file').setInputFiles({ name: 'recipe.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
  await expect(dialog.locator('.wf-step')).toHaveCount(2);
  await dialog.locator('#wf-input').setInputFiles(await sample());
  await dialog.getByRole('button', { name: 'Check workflow', exact: true }).click();
  await expect(dialog.locator('#wf-stage')).toContainText('Preflight complete');
  await expect(dialog.locator('#wf-preflight')).toContainText('3 → 1 pages');
  await expect(dialog.locator('#wf-results a.download')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Run workflow', exact: true }).click();
  await expect(dialog.locator('#wf-stage')).toContainText('Finished', { timeout: 60000 });
  await returnToEditor(page);
  const output = await bytes(page, dialog.locator('#wf-results a.download'));
  const doc = await PDFDocument.load(output);
  expect(doc.getPageCount()).toBe(1); expect(doc.getPage(0).getWidth()).toBe(402);
  expect(await page.evaluate(() => localStorage.getItem('docflow.workflow-recipes.v1'))).toBeNull();
});
test('selected retry keeps successes and uses the executed recipe after draft edits', async ({ page }) => {
  const dialog = await open(page);
  await dialog.locator('.wf-step').nth(1).getByRole('button', { name: /Remove step/ }).click();
  await dialog.locator('.wf-step').first().getByRole('button', { name: /Remove step/ }).click();
  await dialog.locator('#wf-new-operation').selectOption('remove-pages');
  await dialog.getByRole('button', { name: 'Add step', exact: true }).click();
  await dialog.locator('.wf-step input').fill('2');
  await dialog.locator('#wf-input').setInputFiles([await sample('short.pdf', 1), await sample('good.pdf', 3)]);
  await dialog.getByRole('button', { name: 'Run workflow', exact: true }).click();
  await expect(dialog.locator('#wf-stage')).toContainText('Finished');
  await returnToEditor(page);
  const goodBefore = await bytes(page, dialog.locator('#wf-results a.download'));
  await dialog.locator('.wf-step input').fill('1');
  await dialog.locator('#wf-input').setInputFiles(await sample('new-pending.pdf', 3));
  await expect(dialog.locator('#wf-results a.download')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Retry short.pdf', exact: true }).click();
  await expect(dialog.locator('#wf-stage')).toContainText('Finished');
  await returnToEditor(page);
  await expect(dialog.locator('.batch-row[data-state=failed]')).toContainText('Step 1');
  await expect(dialog.locator('.batch-row[data-state=pending]')).toContainText('new-pending.pdf');
  expect(await bytes(page, dialog.locator('#wf-results a.download'))).toEqual(goodBefore);
});
test('review comparison retains the original source when a different input is selected later', async ({ page }) => {
  const dialog = await open(page, 'rotate');
  await dialog.locator('#workspace-file').setInputFiles(await sample('old.pdf', 1));
  await dialog.locator('#run-operation').click();
  await expect(page.locator('[data-result-page]')).toBeVisible();
  await returnToEditor(page);
  const review = dialog.locator('.export-review').first(); await expect(review).toBeVisible();
  await dialog.locator('#workspace-file').setInputFiles(await sample('new.pdf', 2));
  await review.locator('summary').click();
  await review.getByRole('button', { name: 'Compare with original', exact: true }).click();
  await expect(dialog.locator('#file-list .file-row')).toHaveCount(2);
  await expect(dialog.locator('#file-list')).toContainText('old.pdf');
  await expect(dialog.locator('#file-list')).not.toContainText('new.pdf');
});
test('export review renames, reopens and continues a result without applying the operation twice', async ({ page }) => {
  const dialog = await open(page, 'rotate');
  await dialog.locator('#workspace-file').setInputFiles(await sample('turn.pdf', 1));
  await dialog.locator('#run-operation').click();
  await expect(page.locator('[data-result-page]')).toBeVisible();
  await returnToEditor(page);
  const review = dialog.locator('.export-review').first();
  await expect(review).toBeVisible();
  await review.locator('summary').click();
  await review.getByLabel('Output filename').fill('My reviewed copy');
  const link = dialog.locator('a.download').first();
  await expect(link).toHaveAttribute('download', 'My reviewed copy.pdf');
  await expect(review).toContainText('application/pdf');
  await review.getByRole('button', { name: 'Continue with this result', exact: true }).click();
  await expect(dialog.locator('[data-session-action="export"]')).toBeVisible();
  const result = await bytes(page, dialog.locator('[data-session-action="export"]'));
  expect((await PDFDocument.load(result)).getPage(0).getRotation().angle).toBe(90);
  await expect(dialog.locator('.session-history')).toContainText('Rotate');
  await expect(dialog.locator('#preview-area canvas').first()).toBeVisible();
});
test('mobile recipe transfer controls have labels, visible focus and no serious axe violations', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await open(page);
  await dialog.getByRole('link', { name: 'Export recipe' }).focus();
  await expect(dialog.getByRole('link', { name: 'Export recipe' })).toBeFocused();
  const results = await new AxeBuilder({ page }).include('#workspace-dialog').analyze();
  expect(results.violations.filter(item => ['serious','critical'].includes(item.impact ?? ''))).toEqual([]);
});
test('output renaming invalidates the old ZIP and rebuilds with the chosen name', async ({ page }) => {
  const dialog = await open(page);
  await dialog.locator('#wf-input').setInputFiles(await sample('rename.pdf', 1));
  await dialog.getByRole('button', { name: 'Run workflow', exact: true }).click();
  await expect(dialog.locator('#wf-stage')).toContainText('Finished');
  await returnToEditor(page);
  await dialog.getByRole('button', { name: 'Prepare ZIP', exact: true }).click();
  await expect(page.locator('[data-result-page]')).toBeVisible();
  await returnToEditor(page);
  const zipLink = dialog.locator('#wf-results a[download="docflow-workflow-results.zip"]'); await expect(zipLink).toBeVisible();
  const review = dialog.locator('#wf-results > .export-review').first(); await review.locator('summary').click();
  await review.getByLabel('Output filename').fill('renamed');
  await expect(zipLink).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Prepare ZIP', exact: true }).click();
  const archive = await (await import('jszip')).default.loadAsync(await bytes(page, zipLink));
  expect(Object.keys(archive.files)).toEqual(['renamed.pdf']);
});
test('a delayed recipe import cannot overwrite a more recent name edit', async ({ page }) => {
  await page.addInitScript(() => {
    const original = File.prototype.text;
    File.prototype.text = function () {
      if (this.name !== 'slow.json') return original.call(this);
      return new Promise<string>(resolve => { (window as unknown as { releaseImport: () => void }).releaseImport = () => { void original.call(this).then(resolve); }; });
    };
  });
  const dialog = await open(page);
  await dialog.getByLabel('Import recipe file').setInputFiles({ name: 'slow.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'docflow-workflow', version: 1, recipe: { id: 'old', name: 'OLD IMPORT', steps: [{ id: 'r', operation: 'rotate', options: {} }] } })) });
  await dialog.locator('#wf-name').fill('Latest name');
  await page.evaluate(() => (window as unknown as { releaseImport: () => void }).releaseImport());
  await expect(dialog.locator('#wf-name')).toHaveValue('Latest name');
  const recipe = JSON.parse((await bytes(page, dialog.getByRole('link', { name: 'Export recipe' }))).toString());
  expect(recipe.recipe.name).toBe('Latest name');
});
