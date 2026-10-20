import { expect, test } from '@playwright/test';
import { PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFile } from 'node:fs/promises';

const base='/zubaer-ahmed-PDF-TEST/';
async function fixture(){
  const pdf=await PDFDocument.create();const p=pdf.addPage([600,800]);
  const font=await pdf.embedFont(StandardFonts.Helvetica);
  p.drawText('Original content stays on the page',{x:45,y:720,font,size:14});
  return {name:'editable.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())};
}
async function open(page:import('@playwright/test').Page){
  await page.goto(base+'#/tools/edit-pdf');
  await page.locator('[data-file-input]').setInputFiles(await fixture());
  await expect(page.locator('[data-editor-add="text"]')).toBeVisible();
}
async function download(page:import('@playwright/test').Page):Promise<Buffer>{
  await page.locator('[data-run]').click();
  await expect(page.locator('.df2-result')).toBeVisible();
  const pending=page.waitForEvent('download');
  await page.locator('.df2-output').click();
  const path=await(await pending).path();if(!path)throw Error('No download');
  return readFile(path);
}
test('new PDF editor adds actual text and sticky notes while retaining original text',async({page})=>{
  await open(page);
  await page.locator('[data-editor-add="text"]').click();
  await expect(page.locator('[data-edit-id]')).toHaveCount(1);
  await page.locator('textarea[name=editorText]').fill('New customer note');
  await page.locator('textarea[name=editorText]').dispatchEvent('change');
  await page.locator('[data-editor-add="comment"]').click();
  await page.locator('textarea[name=editorText]').fill('Needs review');
  await page.locator('textarea[name=editorText]').dispatchEvent('change');
  await expect(page.locator('[data-edit-id]')).toHaveCount(2);
  // Undo first reverts the edited note text, then removes the note.
  await page.locator('[data-editor-undo]').click();
  await expect(page.locator('[data-edit-id]')).toHaveCount(2);
  await page.locator('[data-editor-undo]').click();
  await expect(page.locator('[data-edit-id]')).toHaveCount(1);
  await page.locator('[data-editor-redo]').click();
  await page.locator('[data-editor-redo]').click();
  await expect(page.locator('[data-edit-id]')).toHaveCount(2);
  const bytes=await download(page);
  const pdf=await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBe(1);
  const annots=pdf.getPage(0).node.Annots();
  expect(annots?.size()).toBe(1);
  const note=pdf.context.lookup(annots!.get(0),PDFDict);
  expect(note.get(PDFName.of('Subtype'))?.toString()).toBe('/Text');
  const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true});
  const rendered=await task.promise;
  try{
    const content=await(await rendered.getPage(1)).getTextContent();
    const words=content.items.map(x=>'str'in x?x.str:'').join(' ');
    expect(words).toContain('Original content stays on the page');
    expect(words).toContain('New customer note');
  }finally{await rendered.destroy();}
});
test('edit objects move with pointer or keyboard and undo maintains real positions',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(base+'#/tools/edit-pdf');
  await page.locator('[data-file-input]').setInputFiles(await fixture());
  await page.getByRole('button',{name:'Options'}).click();
  await expect(page.locator('[data-editor-add="rectangle"]')).toBeVisible();
  await page.locator('[data-editor-add="rectangle"]').click();
  const selected=page.locator('[data-edit-id]').first();
  const originalX=Number(await page.locator('input[name=x]').inputValue());
  await selected.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('input[name=x]')).toHaveValue(String(originalX+1));
  await page.locator('[data-editor-undo]').click();
  await page.locator('[data-editor-select]').first().click();
  await expect(page.locator('input[name=x]')).toHaveValue(String(originalX));
  const bytes=await download(page);
  const out=await PDFDocument.load(bytes);
  expect(out.getPageCount()).toBe(1);
  expect(out.getPage(0).node.Contents()).toBeDefined();
});
