import { test, expect, type Page, type Locator } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFile } from 'node:fs/promises';

async function fixture(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.setTitle('SECRET-PRIVATE-TITLE');
  pdf.setAuthor('SECRET-PRIVATE-AUTHOR');
  const first = pdf.addPage([550,700]);
  first.drawText('TOP SECRET DO NOT SHARE', { x: 48, y: 520, size: 25, font });
  first.drawText('Visible but public footer', { x: 48, y: 100, size: 15, font });
  const second = pdf.addPage([550,700]);
  second.drawText('Another confidential page', { x: 40, y: 440, size: 22, font });
  return Buffer.from(await pdf.save());
}
async function open(page: Page, label: string, id: string): Promise<Locator> {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.getByLabel('Search tools').fill(label);
  await page.locator('#tool-grid [data-open-tool="' + id + '"]').click();
  const dialog = page.getByRole('dialog',{name:'Workspace'});
  await expect(dialog).toBeVisible();
  return dialog;
}
async function downloaded(page: Page, link: Locator): Promise<Buffer> {
  const event = page.waitForEvent('download');
  await link.click();
  const file = await event;
  const location = await file.path();
  if (!location) throw Error('No downloaded output');
  return readFile(location);
}

test('permanent redaction exports image-only PDF, no original text or metadata', async ({ page }) => {
  const dialog = await open(page, 'permanent redaction', 'redact-secure');
  await dialog.locator('#pro-pdf').setInputFiles({ name:'secret.pdf',mimeType:'application/pdf',buffer:await fixture() });
  await expect(dialog.locator('#pro-page-status')).toContainText('Page 1 of 2');
  await dialog.locator('#pro-coordinates input[name=x]').fill('7');
  await dialog.locator('#pro-coordinates input[name=y]').fill('20');
  await dialog.locator('#pro-coordinates input[name=width]').fill('90');
  await dialog.locator('#pro-coordinates input[name=height]').fill('18');
  await dialog.getByRole('button',{name:'Add area using coordinates'}).click();
  await expect(dialog.locator('#pro-mark-count')).toContainText('1 redaction area');
  await dialog.locator('#pro-confirm').check();
  await dialog.getByRole('button',{name:'Apply permanent redactions'}).click();
  await expect(dialog.locator('#pro-stage')).toHaveText('Complete',{timeout:90000});
  const output = await downloaded(page, dialog.locator('#pro-results a.download'));
  const doc = await PDFDocument.load(output);
  expect(doc.getPageCount()).toBe(2);
  expect(doc.getTitle()).not.toContain('SECRET-PRIVATE-TITLE');
  expect(doc.getAuthor()).not.toContain('SECRET-PRIVATE-AUTHOR');
  expect(doc.getForm().getFields()).toHaveLength(0);
  const loading = getDocument({data:new Uint8Array(output)});
  const parsed = await loading.promise;
  for(let p=1;p<=parsed.numPages;p++){
    const content = await (await parsed.getPage(p)).getTextContent();
    expect(content.items).toHaveLength(0);
  }
  await parsed.destroy();
  expect(output.includes(Buffer.from('TOP SECRET DO NOT SHARE'))).toBe(false);
  expect(output.includes(Buffer.from('SECRET-PRIVATE-TITLE'))).toBe(false);
});

test('redaction requires an actual area and informed confirmation',async({page})=>{
  const dialog=await open(page,'permanent redaction','redact-secure');
  await dialog.locator('#pro-pdf').setInputFiles({name:'sample.pdf',mimeType:'application/pdf',buffer:await fixture()});
  await expect(dialog.locator('#pro-page-status')).toContainText('Page 1 of 2');
  await dialog.getByRole('button',{name:'Apply permanent redactions'}).click();
  await expect(dialog.locator('#pro-error')).toContainText('confirm');
  await dialog.locator('#pro-confirm').check();
  await dialog.getByRole('button',{name:'Apply permanent redactions'}).click();
  await expect(dialog.locator('#pro-error')).toContainText('at least one area');
  await expect(dialog.locator('#pro-results a.download')).toHaveCount(0);
});

test('structural repair exports a reopenable PDF without rasterizing text',async({page})=>{
  const dialog=await open(page,'repair PDF','repair-pdf');
  await dialog.locator('#pro-pdf').setInputFiles({name:'source.pdf',mimeType:'application/pdf',buffer:await fixture()});
  await dialog.getByRole('button',{name:'Attempt structural repair'}).click();
  await expect.poll(async () => {
    const stage = await dialog.locator('#pro-stage').innerText();
    if (stage === 'Failed') throw Error('Repair failed: ' + await dialog.locator('#pro-error').innerText());
    return stage;
  }, { timeout: 90000 }).toBe('Complete');
  const output=await downloaded(page,dialog.locator('#pro-results a.download'));
  const pdf=await PDFDocument.load(output);
  expect(pdf.getPageCount()).toBe(2);
  const loading=getDocument({data:new Uint8Array(output)});
  const parsed=await loading.promise;
  const strings=(await (await parsed.getPage(1)).getTextContent()).items.map(t=>'str' in t?t.str:'').join(' ');
  expect(strings).toContain('TOP SECRET DO NOT SHARE');
  await parsed.destroy();
});

test('redaction offers keyboard coordinate entry on narrow mobile viewport',async({page})=>{
  await page.setViewportSize({width:375,height:780});
  const dialog=await open(page,'permanent redaction','redact-secure');
  await dialog.locator('#pro-pdf').setInputFiles({name:'mobile.pdf',mimeType:'application/pdf',buffer:await fixture()});
  await expect(dialog.locator('#pro-page-status')).toContainText('Page 1 of 2');
  await dialog.locator('#pro-coordinates input[name=x]').fill('15');
  await dialog.getByRole('button',{name:'Add area using coordinates'}).click();
  await expect(dialog.locator('#pro-mark-count')).toContainText('1 redaction area');
  await dialog.getByRole('button',{name:'Next page'}).click();
  await expect(dialog.locator('#pro-page-status')).toContainText('Page 2 of 2');
  await dialog.getByRole('button',{name:'Undo last area'}).click();
  await expect(dialog.locator('#pro-mark-count')).toContainText('0 redaction area');
});
