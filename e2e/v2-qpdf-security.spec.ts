import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFile } from 'node:fs/promises';
import { repairCorpus } from '../tests/fixtures/pdfCorpus';
const prefix='/zubaer-ahmed-PDF-TEST/';
const password='DocFlow-Test-2026!';
async function source(){
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);
  const page=doc.addPage([421,612]);page.drawText('Preserve this content',{x:40,y:560,font,size:16});
  return {name:'sensitive.pdf',mimeType:'application/pdf',buffer:Buffer.from(await doc.save())};
}
async function resultBytes(page:import('@playwright/test').Page):Promise<Buffer>{
  await expect(page.locator('.df2-result')).toBeVisible({timeout:30000});
  const pending=page.waitForEvent('download');
  await page.locator('.df2-output').first().click();
  const file=await(await pending).path();
  if(!file)throw Error('Missing downloaded PDF');
  return readFile(file);
}
test('AES-256 PDF protection validates passwords and round-trips through the real qpdf unlock worker',async({page})=>{
  await page.goto(prefix+'#/tools/protect-pdf');
  await page.locator('[data-file-input]').setInputFiles(await source());
  await page.locator('input[name=securityPassword]').fill(password);
  await page.locator('input[name=confirmPassword]').fill('Wrong-Password');
  await page.locator('[data-run]').click();
  await expect(page.locator('[data-run-status]')).toContainText('does not match');
  await expect(page.locator('.df2-result')).toHaveCount(0);
  await page.locator('input[name=confirmPassword]').fill(password);
  await page.locator('[data-run]').click();
  const protectedBytes=await resultBytes(page);
  await expect(page.getByText('Preview exported PDF',{exact:true})).toHaveCount(0);
  expect(protectedBytes.subarray(0,5).toString('latin1')).toBe('%PDF-');
  await expect(PDFDocument.load(protectedBytes)).rejects.toThrow();
  await page.getByRole('button',{name:'Return to editing'}).click();
  await expect(page.locator('input[name=securityPassword]')).toHaveValue('');
  await expect(page.locator('input[name=confirmPassword]')).toHaveValue('');
  page.once('dialog',dialog=>dialog.accept());
  await page.goto(prefix+'#/tools/unlock-pdf');
  await page.locator('[data-file-input]').setInputFiles({
    name:'locked.pdf',mimeType:'application/pdf',buffer:protectedBytes
  });
  await expect(page.locator('.df2-work')).toBeVisible();
  await page.locator('input[name=securityPassword]').fill(password);
  await page.locator('[data-run]').click();
  const unlocked=await PDFDocument.load(await resultBytes(page));
  expect(unlocked.getPageCount()).toBe(1);
  expect(unlocked.getPage(0).getWidth()).toBe(421);
});
test('qpdf repair rewrites valid PDF structure without losing pages',async({page})=>{
  await page.goto(prefix+'#/tools/repair-pdf');
  await page.locator('[data-file-input]').setInputFiles(await source());
  await expect(page.locator('.df2-work')).toBeVisible();
  await page.locator('[data-run]').click();
  const output=await PDFDocument.load(await resultBytes(page));
  expect(output.getPageCount()).toBe(1);
  expect(output.getPage(0).getWidth()).toBe(421);
  expect(output.getPage(0).getHeight()).toBe(612);
});
for (const damage of ['wrong-startxref', 'missing-xref'] as const) {
  test('repair reconstructs '+damage+' and keeps the original text',async({page})=>{
    await page.goto(prefix+'#/tools/repair-pdf');
    await page.locator('[data-file-input]').setInputFiles({name:damage+'.pdf',mimeType:'application/pdf',buffer:repairCorpus(damage)});
    await page.locator('[data-run]').click();
    const bytes=await resultBytes(page);
    await expect(page.locator('.df2-review-warning')).toContainText(/warning/i);
    const doc=await getDocument({
      data:new Uint8Array(bytes),stopAtErrors:true,
      standardFontDataUrl:new URL('../node_modules/pdfjs-dist/standard_fonts/',import.meta.url).pathname,
    }).promise;
    try {
      expect(doc.numPages).toBe(1);
      const contents=await (await doc.getPage(1)).getTextContent();
      expect(contents.items.map(item=>'str' in item?item.str:'').join(' ')).toContain('DocFlow repair corpus v1');
    } finally {await doc.destroy();}
  });
}
test('repair with a missing page object fails before exposing a download',async({page})=>{
  await page.goto(prefix+'#/tools/repair-pdf');
  await page.locator('[data-file-input]').setInputFiles({name:'missing-page.pdf',mimeType:'application/pdf',buffer:repairCorpus('missing-page')});
  await page.locator('[data-run]').click();
  await expect(page.locator('[data-run-status]')).toContainText('Could not finish:');
  await expect(page.locator('.df2-output')).toHaveCount(0);
});
test('repair refuses an output that exceeds the page verification limit',async({page})=>{
  const doc=await PDFDocument.create();
  for(let i=0;i<1001;i++)doc.addPage([72,72]);
  await page.goto(prefix+'#/tools/repair-pdf');
  await page.locator('[data-file-input]').setInputFiles({name:'too-many-pages.pdf',mimeType:'application/pdf',buffer:Buffer.from(await doc.save())});
  await page.locator('[data-run]').click();
  await expect(page.locator('[data-run-status]')).toContainText('1–1000 pages');
  await expect(page.locator('.df2-output')).toHaveCount(0);
});
test('cancelling repair during independent verification never publishes a download',async({page})=>{
  await page.addInitScript(()=>{
    const post=Worker.prototype.postMessage;
    Worker.prototype.postMessage=function(message:unknown,...options:unknown[]){
      if ((message as {action?:string}|null)?.action==='GetOperatorList' &&
          !document.documentElement.dataset.repairValidation &&
          document.querySelector('[data-run-status]')?.textContent?.startsWith('Validating repaired page')){
        document.documentElement.dataset.repairValidation='pending';
        return;
      }
      Reflect.apply(post,this,[message,...options]);
    };
  });
  await page.goto(prefix+'#/tools/repair-pdf');
  await page.locator('[data-file-input]').setInputFiles(await source());
  await page.locator('[data-run]').click();
  await expect(page.locator('html')).toHaveAttribute('data-repair-validation','pending');
  await page.locator('[data-cancel-processing]').click();
  await expect(page.locator('[data-run-status]')).toContainText('Cancelled');
  await expect(page.locator('.df2-output')).toHaveCount(0);
  await expect(page.locator('[data-run]')).toBeEnabled();
  await page.locator('[data-run]').click();
  expect((await PDFDocument.load(await resultBytes(page))).getPageCount()).toBe(1);
});
test('sending a protected PDF to Unlock does not retain the cleartext workspace',async({page})=>{
  await page.goto(prefix+'#/tools/rotate');
  await page.locator('[data-file-input]').setInputFiles(await source());
  await page.locator('[data-run]').click();
  const handoff=async(tool:string)=>{
    await page.getByText('Use PDF in another tool',{exact:true}).click();
    await page.getByRole('combobox',{name:'Next tool'}).selectOption(tool);
    await page.getByRole('button',{name:'Open selected PDF'}).click();
  };
  await handoff('protect-pdf');
  await expect(page.getByRole('button',{name:/Previous revision/})).toBeEnabled();
  await page.locator('[name=securityPassword]').fill(password);
  await page.locator('[name=confirmPassword]').fill(password);
  await page.locator('[data-run]').click();
  await expect(page.locator('.df2-output')).toBeVisible();
  const history=page.getByRole('navigation',{name:'Revision history'});
  await expect(history).toHaveCount(0);
  await handoff('unlock-pdf');
  await expect(page.locator('[name=securityPassword]')).toHaveValue('');
  await expect(history).toHaveCount(0);
  await page.locator('[name=securityPassword]').fill(password);
  await page.locator('[data-run]').click();
  const unlocked=await PDFDocument.load(await resultBytes(page));
  expect(unlocked.getPage(0).getRotation().angle).toBe(90);
});
