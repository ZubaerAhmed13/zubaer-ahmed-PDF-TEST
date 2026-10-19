import { returnToEditor } from './helpers/editorReturn';
import { expect, test, type Page, type Locator } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

const path = '/zubaer-ahmed-PDF-TEST/';
async function sample(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) {
    const page = pdf.addPage([600, 800]);
    page.drawText('DocFlow searchable sample ' + (i + 1), { x: 50, y: 720, size: 18, font });
  }
  return Buffer.from(await pdf.save());
}
async function open(page: Page, name: string, id: string): Promise<Locator> {
  await page.goto(path);
  await page.getByLabel('Search tools').fill(name);
  await page.locator('#tool-grid [data-open-tool="' + id + '"]').click();
  const dialog = page.getByRole('region', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  await dialog.locator('#workspace-file').setInputFiles({ name: 'two-pages.pdf', mimeType: 'application/pdf', buffer: await sample() });
  return dialog;
}
async function download(page: Page, dialog: Locator, label: RegExp): Promise<Buffer> {
  await returnToEditor(page);
  const promise = page.waitForEvent('download');
  await dialog.getByRole('link', { name: label }).click();
  const file = await promise;
  const filePath = await file.path();
  if (!filePath) throw Error('No saved download');
  return readFile(filePath);
}

test('crop changes CropBox and preserves page content and source media box', async ({ page }) => {
  const dialog = await open(page, 'crop', 'crop');
  await dialog.locator('input[name="left"]').fill('30');
  await dialog.locator('input[name="right"]').fill('20');
  await dialog.locator('input[name="top"]').fill('40');
  await dialog.locator('input[name="bottom"]').fill('25');
  await dialog.getByRole('button', { name: 'Run Crop PDF' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Complete');
  await returnToEditor(page);
  const pdf = await PDFDocument.load(await download(page, dialog, /^Download cropped\.pdf/));
  expect(pdf.getPageCount()).toBe(2);
  expect(pdf.getPage(0).getCropBox()).toMatchObject({ x: 30, y: 25, width: 550, height: 735 });
  expect(pdf.getPage(0).getMediaBox()).toMatchObject({ width: 600, height: 800 });
});

test('text search finds page-aware matches and exports selectable text only', async ({ page }) => {
  const dialog = await open(page, 'search & extract text', 'text-search');
  await dialog.locator('input[name="query"]').fill('DocFlow');
  await dialog.getByRole('button', { name: 'Run Search & extract text' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Complete');
  await returnToEditor(page);
  await expect(dialog.locator('#text-search-matches')).toContainText('2 page(s) with matches');
  const content = (await download(page, dialog, /^Download extracted-text\.txt/)).toString('utf8');
  expect(content).toContain('DocFlow searchable sample 1');
  expect(content).toContain('DocFlow searchable sample 2');
});

test('standard metadata editing exports reopenable PDF', async ({ page }) => {
  const dialog = await open(page, 'edit document properties', 'metadata-edit');
  await dialog.locator('input[name="title"]').fill('Research Notes');
  await dialog.locator('input[name="author"]').fill('Private author');
  await dialog.getByRole('button', { name: 'Run Edit document properties' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Complete');
  await returnToEditor(page);
  const pdf = await PDFDocument.load(await download(page, dialog, /^Download properties-edited\.pdf/));
  expect(pdf.getTitle()).toBe('Research Notes');
  expect(pdf.getAuthor()).toBe('Private author');
});

test('annotate and sign generate valid visual-only PDFs', async ({ page }) => {
  let dialog = await open(page, 'annotate', 'annotate');
  await dialog.locator('textarea[name="text"]').fill('Review this document');
  await dialog.getByRole('button', { name: 'Run Annotate PDF' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Complete');
  await returnToEditor(page);
  expect((await PDFDocument.load(await download(page, dialog, /^Download annotated\.pdf/))).getPageCount()).toBe(2);
  await page.getByRole('button', { name: 'Back to all tools', exact: true }).click();

  dialog = await open(page, 'visual signature', 'sign-visual');
  await dialog.locator('input[name="signatureText"]').fill('A. Example');
  await dialog.getByRole('button', { name: 'Run Visual signature' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Complete');
  await returnToEditor(page);
  expect((await PDFDocument.load(await download(page, dialog, /^Download visually-signed\.pdf/))).getPageCount()).toBe(2);
});

test('Phase 2 tools do not persist typed signature and annotation text in recovery', async ({ page }) => {
  const dialog = await open(page, 'visual signature', 'sign-visual');
  await dialog.locator('input[name="signatureText"]').fill('SECRET-SIGNATURE-NOT-PERSISTED');
  await expect(dialog.locator('[data-project-save-status]')).toContainText('saved locally');
  const storage = await page.evaluate(async () => {
    const names = await indexedDB.databases();
    const name = names.find(x => x.name?.includes('docflow-project'))?.name;
    if (!name) return '';
    return new Promise<string>((resolve) => {
      const req = indexedDB.open(name);
      req.onerror = () => resolve('');
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.length) { db.close(); resolve(''); return; }
        const names = [...db.objectStoreNames];
        const tx = db.transaction(names, 'readonly');
        const reads = names.map(key => new Promise<unknown>((yes) => {
          const req = tx.objectStore(key).getAll();
          req.onsuccess = () => yes(req.result);
          req.onerror = () => yes(null);
        }));
        void Promise.all(reads).then(values => { db.close(); resolve(JSON.stringify(values)); });
      };
    });
  });
  expect(storage).not.toContain('SECRET-SIGNATURE-NOT-PERSISTED');
});
