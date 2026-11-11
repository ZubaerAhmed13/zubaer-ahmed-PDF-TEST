import { expect, test, type Page } from '@playwright/test';
import { degrees, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts } from 'pdf-lib';
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

async function highlightFixture(multiRegion=false){
  const doc=await PDFDocument.create(),sheet=doc.addPage([400,500]);
  sheet.setCropBox(30,40,330,430);
  sheet.setRotation(degrees(90));
  sheet.drawText('Original searchable text',{x:80,y:360,size:12});
  if(multiRegion)sheet.node.addAnnot(doc.context.register(doc.context.obj({
    Type:'Annot',Subtype:'Highlight',Rect:[60,200,180,250],C:[1,1,0],
    QuadPoints:[60,250,180,250,60,230,180,230,60,220,180,220,60,200,180,200],
    Contents:PDFString.of('External two-line highlight'),
  })));
  return Buffer.from(await doc.save());
}

async function upload(page:Page,buffer:Buffer,replace=false){
  if(replace)page.once('dialog',dialog=>dialog.accept());
  await page.locator(replace?'[data-add-file]':'[data-file-input]').setInputFiles({
    name:'review.pdf',mimeType:'application/pdf',buffer,
  });
}

async function highlights(bytes:Buffer){
  const doc=await PDFDocument.load(bytes);
  return (doc.getPage(0).node.Annots()?.asArray()??[])
    .map(ref=>doc.context.lookup(ref,PDFDict))
    .filter(item=>item.get(PDFName.of('Subtype'))?.toString()==='/Highlight');
}

async function property(page:Page,name:string,value:string){
  const field=page.locator(`[data-editor-properties] [name=${name}]`);
  await field.fill(value);
  await field.dispatchEvent('change');
}

function highlightPixel(page:Page,x:number,y:number){
  return page.locator('[data-page-canvas]').evaluate((canvas:HTMLCanvasElement,{x,y})=>Array.from(
    canvas.getContext('2d')!.getImageData(Math.round(x*canvas.width/430),Math.round(y*canvas.height/330),1,1).data.slice(0,3),
  ),{x,y});
}

async function exportedText(bytes:Buffer){
  const doc=await getDocument({data:new Uint8Array(bytes),standardFontDataUrl:new URL('../node_modules/pdfjs-dist/standard_fonts/',import.meta.url).pathname}).promise;
  try{
    const text=await (await doc.getPage(1)).getTextContent();
    return text.items.map(item=>'str'in item?item.str:'').join(' ');
  }finally{await doc.destroy();}
}

test('native highlights reopen for editing on a rotated CropBox without ghost pixels or lost text',async({page})=>{
  test.setTimeout(90000);
  await page.goto(base+'#/tools/edit-pdf');
  const writes:string[]=[];
  page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
  await upload(page,await highlightFixture());
  const add=page.getByRole('button',{name:'Editable highlight',exact:true});
  const marks=page.locator('.df2-edit-native-highlight');
  await add.click();
  await property(page,'x','40');await property(page,'y','65');
  await property(page,'width','100');await property(page,'height','35');
  const first=await download(page);
  const original=await highlights(first);
  expect(original).toHaveLength(1);
  expect(original[0]!.has(PDFName.of('AP'))).toBe(true);
  await page.getByRole('button',{name:'Start another file'}).click();
  await upload(page,first);
  await expect(marks).toHaveCount(1);
  expect(await highlightPixel(page,60,80)).toEqual([255,255,255]);

  await page.locator('[data-editor-select]').click();
  await expect(page.getByLabel('X (points)')).toHaveValue('40');
  await expect(page.getByLabel('Y (points)')).toHaveValue('65');
  expect(await page.locator('[data-editor-undo]').isDisabled()).toBe(true);
  await property(page,'editorText','Review this section ✓');
  await property(page,'color','#33cc66');
  await property(page,'x','70');
  await page.getByRole('button',{name:'Duplicate selected object'}).click();
  await expect(marks).toHaveCount(2);
  await page.locator('[data-editor-undo]').click();
  await expect(marks).toHaveCount(1);
  const revised=await download(page);
  const updated=await highlights(revised);
  expect(updated).toHaveLength(1);
  expect(updated[0]!.lookup(PDFName.of('Contents'),PDFHexString).decodeText()).toBe('Review this section ✓');

  await page.getByRole('button',{name:'Start another file'}).click();
  await upload(page,revised);
  await page.locator('[data-editor-select]').click();
  await expect(page.getByLabel('X (points)')).toHaveValue('70');
  await expect(page.getByLabel('Colour')).toHaveValue('#33cc66');
  await page.getByRole('button',{name:'Remove selected object'}).click();
  await expect(marks).toHaveCount(0);
  await page.locator('[data-editor-undo]').click();
  await expect(marks).toHaveCount(1);
  await page.locator('[data-editor-redo]').click();
  await expect(marks).toHaveCount(0);
  expect(await highlightPixel(page,90,80)).toEqual([255,255,255]);
  const final=await download(page);
  expect(await highlights(final)).toHaveLength(0);
  expect(await exportedText(final)).toContain('Original searchable text');
  expect(writes).toEqual([]);
});

test('multi-region highlights remain intact on phone exports',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(base+'#/tools/edit-pdf');
  const original=await highlightFixture(true);
  await upload(page,original);
  await page.getByRole('button',{name:'Options',exact:true}).click();
  await expect(page.getByText(/1 existing highlight is kept unchanged/)).toBeVisible();
  await expect(page.locator('.df2-edit-native-highlight')).toHaveCount(0);
  const before=await highlights(original),after=await highlights(await download(page));
  expect(after.map(mark=>mark.toString())).toEqual(before.map(mark=>mark.toString()));
});

test('applying and undoing a source text change keeps editable highlight pixels out of the canvas',async({page})=>{
  await page.goto(base+'#/tools/edit-pdf');
  await upload(page,await highlightFixture());
  await page.getByRole('button',{name:'Editable highlight',exact:true}).click();
  await property(page,'x','40');await property(page,'y','65');
  await property(page,'width','100');await property(page,'height','35');
  const source=await download(page);
  await page.getByRole('button',{name:'Start another file'}).click();
  await upload(page,source);
  await expect(page.locator('.df2-edit-native-highlight')).toHaveCount(1);
  const pixel=()=>highlightPixel(page,60,80);
  await page.getByRole('button',{name:'Select existing content'}).click();
  await page.locator('.df2-source-list button').filter({hasText:'Original searchable text'}).click();
  await page.getByLabel('Existing text',{exact:true}).fill('Revised searchable text');
  await page.getByRole('button',{name:'Apply source text'}).click();
  await expect(page.locator('[data-native-preview-status]')).toHaveText('Source changes previewed');
  expect(await pixel()).toEqual([255,255,255]);
  await page.locator('[data-editor-undo]').click();
  await expect.poll(pixel).toEqual([255,255,255]);
  await page.locator('[data-editor-redo]').click();
  await expect(page.locator('[data-native-preview-status]')).toHaveText('Source changes previewed');
  expect(await pixel()).toEqual([255,255,255]);
  const result=await download(page);
  expect(await highlights(result)).toHaveLength(1);
  expect(await exportedText(result)).toContain('Revised searchable text');
});

test('an unsupported custom page scale clears stale editor objects and blocks export',async({page})=>{
  await page.goto(base+'#/tools/edit-pdf');
  const original=await highlightFixture();
  await upload(page,original);
  const add=page.getByRole('button',{name:'Editable highlight',exact:true});
  await add.click();
  const bytes=await download(page),doc=await PDFDocument.load(bytes);
  doc.getPage(0).node.set(PDFName.of('UserUnit'),doc.context.obj(2));
  await page.getByRole('button',{name:'Return to editing'}).click();
  await expect(add).toBeVisible();
  await upload(page,Buffer.from(await doc.save()),true);
  await expect(page.locator('[data-render-status]')).toContainText('custom page scale');
  await expect(page.locator('[data-run]')).toBeDisabled();
  await expect(page.locator('[data-edit-id],.df2-output')).toHaveCount(0);
  await upload(page,original,true);
  await expect(add).toBeVisible();
  await expect(page.locator('[data-run]')).toBeEnabled();
  await add.click();
  expect(await highlights(await download(page))).toHaveLength(1);
});
