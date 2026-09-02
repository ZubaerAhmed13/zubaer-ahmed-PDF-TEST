import { expect, test } from '@playwright/test';
import { PDFDocument, PDFName } from 'pdf-lib';

async function xfaFixture(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 500]);
  const packet = new TextEncoder().encode('<?xml version="1.0"?><xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"><template xmlns="http://www.xfa.org/schema/xfa-template/3.3/"></template></xdp:xdp>');
  const xfaStream = doc.context.stream(packet);
  const xfaRef = doc.context.register(xfaStream);
  const acroForm = doc.context.obj({ Fields: [], XFA: xfaRef });
  const acroFormRef = doc.context.register(acroForm);
  doc.catalog.set(PDFName.of('AcroForm'), acroFormRef);
  const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  const reopened = await PDFDocument.load(bytes);
  expect(reopened.getPageCount()).toBe(1);
  return bytes;
}

test('detects a valid PDF with an XFA stream and reports the unsupported-form boundary explicitly', async ({ page }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.getByLabel('Search tools').fill('acroform');
  await page.locator('#tool-grid [data-open-tool="forms"]').click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await dialog.locator('#workspace-file').setInputFiles({
    name: 'xfa-form.pdf',
    mimeType: 'application/pdf',
    buffer: await xfaFixture()
  });
  await dialog.getByRole('button', { name: 'Inspect form fields' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Failed');
  await expect(dialog.locator('#error')).toContainText('UNSUPPORTED_FORM');
  await expect(dialog.locator('#error')).toContainText('XFA forms');
  await expect(dialog.getByRole('button', { name: 'Run Fill PDF forms' })).toBeEnabled();
});
