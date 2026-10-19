import { returnToEditor } from './helpers/editorReturn';
import { test, expect, type Page, type Locator } from '@playwright/test';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFile } from 'node:fs/promises';
import { redactionCorpus, repairCorpus } from '../tests/fixtures/pdfCorpus';
import { pdfPixels } from './helpers/pdfPixels';

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
  const dialog = page.getByRole('region',{name:'Workspace'});
  await expect(dialog).toBeVisible();
  return dialog;
}
async function downloaded(page: Page, link: Locator): Promise<Buffer> {
  await returnToEditor(page);
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
  await returnToEditor(page);
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

test('redacted pixels cover the intended viewport region at every rotation and retain surrounding content', async ({ page }) => {
  test.setTimeout(120_000);
  const source = await redactionCorpus();
  const dialog = await open(page, 'permanent redaction', 'redact-secure');
  await dialog.locator('#pro-pdf').setInputFiles({ name: 'rotated-cropped-forms-images.pdf', mimeType: 'application/pdf', buffer: source });
  await expect(dialog.locator('#pro-page-status')).toContainText('Page 1 of 4');
  for (let index = 1; index <= 4; index++) {
    await dialog.locator('#pro-coordinates input[name=x]').fill('10');
    await dialog.locator('#pro-coordinates input[name=y]').fill('20');
    await dialog.locator('#pro-coordinates input[name=width]').fill('30');
    await dialog.locator('#pro-coordinates input[name=height]').fill('25');
    await dialog.getByRole('button', { name: 'Add area using coordinates' }).click();
    if (index < 4) {
      await dialog.getByRole('button', { name: 'Next page' }).click();
      await expect(dialog.locator('#pro-page-status')).toContainText('Page ' + (index + 1) + ' of 4');
    }
  }
  await dialog.locator('#pro-confirm').check();
  await dialog.getByRole('button', { name: 'Apply permanent redactions' }).click();
  await expect(dialog.locator('#pro-stage')).toHaveText('Complete', { timeout: 90_000 });
  await returnToEditor(page);
  const output = await downloaded(page, dialog.locator('#pro-results a.download'));
  const parsed = await PDFDocument.load(output);
  expect(parsed.getForm().getFields()).toHaveLength(0);
  expect(parsed.catalog.has(PDFName.of('Names'))).toBe(false);
  for (let index = 1; index <= 4; index++) {
    const before = await pdfPixels(source, index);
    const after = await pdfPixels(output, index);
    expect([after.width, after.height]).toEqual([before.width, before.height]);
    // Every interior pixel must be black, not just an image-only/no-text result.
    let tested = 0;
    for (let y = Math.ceil(after.height * .2) + 3; y < Math.floor(after.height * .45) - 3; y++) {
      for (let x = Math.ceil(after.width * .1) + 3; x < Math.floor(after.width * .4) - 3; x++) {
        const offset = (y * after.width + x) * 4;
        if (Math.max(after.data[offset]!, after.data[offset + 1]!, after.data[offset + 2]!) > 4)
          throw Error('Unmasked pixel in exported redaction on page ' + index + ' at ' + x + ',' + y);
        tested++;
      }
    }
    expect(tested).toBeGreaterThan(1000);
    // A wrong viewport transform must not silently blackout unrelated areas.
    for (const [nx, ny] of [[.8, .8], [.8, .1], [.05, .9]]) {
      const offset = (Math.floor(ny! * after.height) * after.width + Math.floor(nx! * after.width)) * 4;
      for (let channel = 0; channel < 3; channel++)
        expect(Math.abs(after.data[offset + channel]! - before.data[offset + channel]!)).toBeLessThanOrEqual(12);
    }
  }
});

for (const damage of ['wrong-startxref', 'missing-xref'] as const) {
  test('repair reconstructs ' + damage + ' and keeps actual document text', async ({ page }) => {
    const source = repairCorpus(damage);
    expect(source.equals(repairCorpus())).toBe(false);
    const dialog = await open(page, 'repair PDF', 'repair-pdf');
    await dialog.locator('#pro-pdf').setInputFiles({ name: damage + '.pdf', mimeType: 'application/pdf', buffer: source });
    await dialog.getByRole('button', { name: 'Attempt structural repair' }).click();
    await expect(dialog.locator('#pro-stage')).toHaveText('Complete', { timeout: 90_000 });
    await expect(page.locator('[data-result-page] .page-result-warning')).toBeVisible();
    await expect(page.locator('[data-result-page] .page-result-warning')).toContainText('qpdf reported warnings');
    await returnToEditor(page);
    await expect(dialog.locator('.pro-warning')).toContainText('warnings');
    const result = await downloaded(page, dialog.locator('#pro-results a.download'));
    const document = await getDocument({ data: new Uint8Array(result), stopAtErrors: true }).promise;
    try {
      expect(document.numPages).toBe(1);
      const content = await (await document.getPage(1)).getTextContent();
      expect(content.items.map(item => 'str' in item ? item.str : '').join(' ')).toContain('DocFlow repair corpus v1');
    } finally { await document.destroy(); }
  });
}

test('repair fails closed when a referenced page object is missing', async ({ page }) => {
  const dialog = await open(page, 'repair PDF', 'repair-pdf');
  await dialog.locator('#pro-pdf').setInputFiles({ name: 'missing-page.pdf', mimeType: 'application/pdf', buffer: repairCorpus('missing-page') });
  await dialog.getByRole('button', { name: 'Attempt structural repair' }).click();
  await expect(dialog.locator('#pro-stage')).toHaveText('Failed', { timeout: 90_000 });
  await expect(dialog.locator('#pro-error')).toBeVisible();
  await expect(dialog.locator('#pro-results a.download')).toHaveCount(0);
});

test('cancellation during redaction encoding never publishes a partially redacted output', async ({ page }) => {
  const dialog = await open(page, 'permanent redaction', 'redact-secure');
  await dialog.locator('#pro-pdf').setInputFiles({ name: 'cancel.pdf', mimeType: 'application/pdf', buffer: await redactionCorpus() });
  await expect(dialog.locator('#pro-page-status')).toContainText('Page 1 of 4');
  await dialog.getByRole('button', { name: 'Add area using coordinates' }).click();
  await dialog.locator('#pro-confirm').check();
  // Pause a real encoding boundary so the cancellation race is deterministic.
  await page.evaluate(() => {
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      document.documentElement.dataset.r0Encoding = 'pending';
      document.addEventListener('r0-continue-encoding', () => encode.call(this, callback, type, quality), { once: true });
    };
  });
  await dialog.getByRole('button', { name: 'Apply permanent redactions' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-r0-encoding', 'pending');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => document.dispatchEvent(new Event('r0-continue-encoding')));
  await expect(dialog.locator('#pro-error')).toContainText('cancelled');
  await expect(dialog.locator('#pro-results a.download')).toHaveCount(0);
});
