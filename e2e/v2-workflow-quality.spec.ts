import {test,expect,type Page} from '@playwright/test';
import {PDFDocument,PDFName,PDFNumber,PDFRawStream,StandardFonts} from 'pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {readFile} from 'node:fs/promises';

const base='/zubaer-ahmed-PDF-TEST/';
async function fixture(){
  const pdf=await PDFDocument.create();const font=await pdf.embedFont(StandardFonts.Helvetica);
  for(let i=0;i<3;i++){const page=pdf.addPage([500+i*20,700]);page.drawText('Original proposal '+(i+1),{x:30,y:650,size:14,font});}
  return {name:'proposal.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())};
}
async function open(page:Page,tool='edit-pdf'){
  await page.goto(base+'#/tools/'+tool);await page.locator('[data-file-input]').setInputFiles(await fixture());
  if(tool==='edit-pdf')await expect(page.locator('[data-editor-add=text]')).toBeAttached({timeout:20000});
  else await expect(page.locator('[data-page-label]')).toContainText('/ 3');
}
async function addText(page:Page,text='Approved'){
  await page.locator('[data-editor-add=text]').click();await page.locator('textarea[name=editorText]').fill(text);
  await page.locator('textarea[name=editorText]').dispatchEvent('change');
}
async function exportBytes(page:Page){
  await page.locator('[data-run]').click();await expect(page.locator('.df2-result')).toBeVisible();
  const pending=page.waitForEvent('download');await page.locator('.df2-output').first().click();
  const path=await(await pending).path();if(!path)throw Error('Download missing');return readFile(path);
}
test('export, browser Back and Return to editing preserve draft and undo history',async({page})=>{
  await open(page);await addText(page);
  await exportBytes(page);await page.goBack();
  await expect(page.locator('[data-edit-id]')).toHaveCount(1);
  await page.locator('[data-editor-undo]').click();await expect(page.locator('[data-edit-id]')).toHaveCount(1);
  await page.locator('[data-editor-undo]').click();await expect(page.locator('[data-edit-id]')).toHaveCount(0);
  await page.locator('[data-editor-redo]').click();await page.locator('[data-editor-redo]').click();
  const bytes=await exportBytes(page);const doc=await getDocument({data:new Uint8Array(bytes)}).promise;
  try{const text=await(await doc.getPage(1)).getTextContent();expect(text.items.map(x=>'str'in x?x.str:'').join(' ')).toContain('Approved');}finally{await doc.destroy();}
  await page.getByRole('button',{name:'Return to editing'}).click();await expect(page.locator('[data-edit-id]')).toHaveCount(1);
});
test('browser navigation retains the text being typed without requiring blur',async({page})=>{
  await open(page);await page.locator('[data-editor-add=text]').click();
  await page.locator('textarea[name=editorText]').fill('Text still being typed');
  await page.goBack();await page.goForward();
  await expect(page.locator('textarea[name=editorText]')).toHaveValue('Text still being typed');
  const bytes=await exportBytes(page),doc=await getDocument({data:new Uint8Array(bytes)}).promise;
  try{const text=await(await doc.getPage(1)).getTextContent();expect(text.items.map(i=>'str'in i?i.str:'').join(' ')).toContain('Text still being typed');}finally{await doc.destroy();}
});
test('tool search opens over the editor and Escape restores the unchanged draft',async({page})=>{
  await open(page);await addText(page);const route=page.url();
  await page.getByRole('button',{name:'Search PDF tools'}).click();
  await expect(page.getByRole('dialog',{name:'Find a PDF tool'})).toBeVisible();
  await page.getByRole('searchbox',{name:'Find PDF tools'}).fill('merge');
  expect(page.url()).toBe(route);await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('[data-edit-id]')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Search PDF tools'})).toBeFocused();
});
test('changing text size scales the on-page text using the export font',async({page},testInfo)=>{
  await open(page);await addText(page,'Sized text');
  const before=await page.locator('.df2-edit-text').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
  await page.locator('input[name=size]').fill('36');await page.locator('input[name=size]').dispatchEvent('change');
  const after=await page.locator('.df2-edit-text').evaluate(el=>({size:parseFloat(getComputedStyle(el).fontSize),font:getComputedStyle(el).fontFamily}));
  expect(after.size/before).toBeCloseTo(2,1);expect(after.font).toContain('DocFlowEditor');
  await page.screenshot({path:testInfo.outputPath('editor-size-preview.png')});
});
test('phone zoom magnifies the page and options dismiss with focus restoration',async({page})=>{
  await page.setViewportSize({width:390,height:844});await open(page);
  const before=(await page.locator('[data-page-canvas]').boundingBox())!.width;
  await page.locator('[data-zoom-in]').click();
  await expect.poll(async()=>(await page.locator('[data-page-canvas]').boundingBox())!.width).toBeGreaterThan(before*1.1);
  await page.getByRole('button',{name:'Options',exact:true}).click();
  await expect(page.getByRole('button',{name:'Close options'})).toBeVisible();await page.keyboard.press('Escape');
  await expect(page.locator('[data-options-pane]')).not.toHaveClass(/opened/);
  await expect(page.getByRole('button',{name:'Options',exact:true})).toBeFocused();
});
test('landscape keeps the primary action inside the visual viewport',async({page})=>{
  await page.setViewportSize({width:844,height:390});await open(page);
  const action=(await page.locator('[data-run]').boundingBox())!;expect(action.y+action.height).toBeLessThanOrEqual(391);
});
test('organiser shows real thumbnails, rearranges by drag, and retains output order after Back',async({page},testInfo)=>{
  await open(page,'organize');
  await expect(page.locator('.df2-plan-row canvas')).toHaveCount(3);
  const cardsRendered=()=>page.locator('.df2-plan-row canvas').evaluateAll(canvases=>canvases.every(element=>{
    const canvas=element as HTMLCanvasElement;
    return canvas.width>20&&canvas.getContext('2d')!.getImageData(0,0,1,1).data[0]!>240;
  }));
  await expect.poll(cardsRendered).toBe(true);
  await page.locator('.df2-plan-row').nth(2).dragTo(page.locator('.df2-plan-row').first());
  await expect(page.locator('.df2-plan-row').first()).toContainText('Page 3');
  await expect.poll(cardsRendered).toBe(true);
  await page.screenshot({path:testInfo.outputPath('organizer-grid.png')});
  const bytes=await exportBytes(page);expect((await PDFDocument.load(bytes)).getPages().map(p=>p.getWidth())).toEqual([540,500,520]);
  await page.goBack();await expect(page.locator('.df2-plan-row').first()).toContainText('Page 3');
});
test('compression advanced choices reach the worker and survive returning from results',async({page})=>{
  await open(page,'compress');await page.getByText('Advanced compression',{exact:true}).click();
  await page.getByRole('spinbutton',{name:'JPEG image quality (%)'}).fill('65');
  await page.getByRole('spinbutton',{name:'Maximum image dimension (px)'}).fill('1400');
  await exportBytes(page);await expect(page.locator('[data-compression-summary]')).toContainText(/Original|Smaller|reduction/i);
  await page.locator('.df2-result-info summary').click();
  await expect(page.locator('.df2-result-info pre')).toContainText('0.65');await expect(page.locator('.df2-result-info pre')).toContainText('1400');
  await page.getByRole('button',{name:'Return to editing'}).click();
  await expect(page.getByRole('spinbutton',{name:'JPEG image quality (%)'})).toHaveValue('65');
});
test('cancelling Start over keeps the file and additions intact',async({page})=>{
  await open(page);await addText(page);page.once('dialog',d=>d.dismiss());
  await page.getByRole('button',{name:'Start over',exact:true}).click();
  await expect(page.locator('[data-edit-id]')).toHaveCount(1);await expect(page.locator('.df2-file')).toContainText('proposal.pdf');
});
test('custom compression downsamples actual JPEG objects and preserves selectable text',async({page})=>{
  await page.goto(base+'#/tools/compress');
  const encoded=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=1800;canvas.height=1200;const ctx=canvas.getContext('2d')!;
    for(let y=0;y<1200;y+=12)for(let x=0;x<1800;x+=12){const n=(x*17+y*31)%255;ctx.fillStyle=`rgb(${n},${n*3%255},${n*7%255})`;ctx.fillRect(x,y,12,12);}
    return canvas.toDataURL('image/jpeg',.98).split(',')[1]!;
  });
  const pdf=await PDFDocument.create(),p=pdf.addPage([595,842]);const jpg=await pdf.embedJpg(Buffer.from(encoded,'base64'));
  p.drawImage(jpg,{x:30,y:180,width:535,height:356});p.drawText('Keep this selectable text',{x:30,y:770,size:18});
  const source=Buffer.from(await pdf.save());await page.locator('[data-file-input]').setInputFiles({name:'image-heavy.pdf',mimeType:'application/pdf',buffer:source});
  await page.getByText('Advanced compression',{exact:true}).click();await page.getByRole('spinbutton',{name:'JPEG image quality (%)'}).fill('65');
  await page.getByRole('spinbutton',{name:'Maximum image dimension (px)'}).fill('1000');
  const bytes=await exportBytes(page),result=await PDFDocument.load(bytes);
  const images=result.context.enumerateIndirectObjects().map(([,o])=>o).filter(o=>o instanceof PDFRawStream&&o.dict.get(PDFName.of('Subtype'))?.toString()==='/Image') as PDFRawStream[];
  expect(images).toHaveLength(1);expect(images[0]!.dict.lookup(PDFName.of('Width'),PDFNumber).asNumber()).toBe(1000);
  expect(bytes.length).toBeLessThan(source.length*.9);
  const document=await getDocument({data:new Uint8Array(bytes)}).promise;
  try{const text=await(await document.getPage(1)).getTextContent();expect(text.items.map(i=>'str'in i?i.str:'').join(' ')).toContain('Keep this selectable text');}finally{await document.destroy();}
});
test('cancelling an export keeps additions and ignores the late font response',async({page})=>{
  await open(page);await addText(page);
  await expect(page.getByRole('button',{name:'Cancel processing',includeHidden:true})).toBeAttached();
  let release!:()=>void,held!:()=>void;const requested=new Promise<void>(r=>{held=r;});
  await page.route('**/fonts/DocFlowSans.woff',async route=>{held();await new Promise<void>(r=>{release=r;});await route.continue();});
  await page.locator('[data-run]').click();await requested;
  try{await page.getByRole('button',{name:'Cancel processing'}).click();}finally{release();}
  await expect(page.locator('[data-run]')).toBeEnabled();await expect(page.locator('[data-edit-id]')).toHaveCount(1);
  await expect(page.locator('[data-run-status]')).toContainText('Cancelled');
});
test('file reordering invalidates an earlier result and Forward recovers a runnable work route',async({page})=>{
  await page.goto(base+'#/tools/merge');
  const first=await fixture(),second=await PDFDocument.create();second.addPage([610,700]);
  await page.locator('[data-file-input]').setInputFiles([first,{name:'second.pdf',mimeType:'application/pdf',buffer:Buffer.from(await second.save())}]);
  await exportBytes(page);await page.goBack();
  await page.getByRole('button',{name:'Move second.pdf up'}).click();await page.goForward();
  await expect(page.locator('[data-run]')).toBeVisible();await expect(page).toHaveURL(/merge\/work$/);
  const result=await PDFDocument.load(await exportBytes(page));expect(result.getPages().map(p=>p.getWidth())).toEqual([610,500,520,540]);
});
test('thumbnail selection invalidates an earlier result before browser Forward',async({page})=>{
  await open(page,'extract-pages');await page.locator('.df2-thumb[data-page="1"]').click();
  await exportBytes(page);await page.goBack();
  await expect(page.locator('.df2-thumb[data-page="1"]')).toHaveAttribute('aria-pressed','true');
  await page.locator('.df2-thumb[data-page="3"]').click();await page.goForward();
  await expect(page.locator('[data-run]')).toBeVisible();await expect(page).toHaveURL(/extract-pages\/work$/);
  const result=await PDFDocument.load(await exportBytes(page));expect(result.getPages().map(p=>p.getWidth())).toEqual([500,540]);
});
