import { expect, test, type Locator, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

const appPath = '/zubaer-ahmed-PDF-TEST/';

async function metadataFixture(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([320, 480]);
  doc.addPage([400, 500]);
  doc.setTitle('DocFlow metadata fixture');
  doc.setAuthor('DocFlow QA');
  doc.setSubject('Metadata certification');
  doc.setKeywords(['docflow', 'metadata', 'qa']);
  doc.setCreator('DocFlow test suite');
  return Buffer.from(await doc.save());
}

async function openTool(page: Page, query: string, toolId: string): Promise<Locator> {
  await page.getByLabel('Search tools').fill(query);
  const openButton = page.locator(`#tool-grid [data-open-tool="${toolId}"]`);
  await expect(openButton).toHaveCount(1);
  await openButton.click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await page.goto(appPath);
  await expect(page.getByRole('heading', { name: /Private PDF tools/ })).toBeVisible();
});

test('document information reports standard metadata and page count from a real PDF fixture', async ({ page }) => {
  const dialog = await openTool(page, 'metadata', 'metadata');
  await dialog.locator('#workspace-file').setInputFiles({
    name: 'metadata-fixture.pdf',
    mimeType: 'application/pdf',
    buffer: await metadataFixture()
  });
  await dialog.getByRole('button', { name: 'Run Document information' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Complete');

  const infoText = await dialog.locator('.info-result').textContent();
  if (!infoText) throw new Error('Metadata result was not rendered.');
  const info = JSON.parse(infoText) as Record<string, unknown>;
  expect(info).toMatchObject({
    title: 'DocFlow metadata fixture',
    author: 'DocFlow QA',
    subject: 'Metadata certification',
    creator: 'DocFlow test suite',
    pageCount: 2,
    encrypted: false
  });
  expect(String(info.keywords)).toContain('docflow');
  expect(String(info.keywords)).toContain('metadata');
});

test('malformed PDF input fails recoverably with the structured INVALID_PDF error', async ({ page }) => {
  const dialog = await openTool(page, 'metadata', 'metadata');
  const corrupt = Buffer.from('%PDF-1.7\nthis is deliberately not a parseable PDF structure\n%%EOF', 'latin1');
  await dialog.locator('#workspace-file').setInputFiles({
    name: 'corrupt.pdf',
    mimeType: 'application/pdf',
    buffer: corrupt
  });
  await dialog.getByRole('button', { name: 'Run Document information' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Failed');
  await expect(dialog.locator('#error')).toContainText('INVALID_PDF');
  await expect(dialog.locator('#error')).toContainText('could not be parsed');
  await expect(dialog.getByRole('button', { name: 'Run Document information' })).toBeEnabled();
});
