import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {PDFDocument} from 'pdf-lib';
const base='/zubaer-ahmed-PDF-TEST/';
async function audit(page:Page){const report=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']).analyze();expect(report.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))).toEqual([]);}
for(const width of [1440,320])test('v2 home accessibility at '+width+' pixels',async({page})=>{await page.setViewportSize({width,height:900});await page.goto(base);await expect(page.getByRole('heading',{name:/Every document/})).toBeVisible();await audit(page);});
test('v2 editing workspace has an accessible document title and controls',async({page})=>{const pdf=await PDFDocument.create();pdf.addPage([400,580]).drawText('Accessible document fixture',{x:20,y:500});await page.goto(base+'#/tools/edit-pdf');await page.locator('[data-file-input]').setInputFiles({name:'document.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});await expect(page.locator('[data-editor-add=text]')).toBeVisible();await audit(page);});

async function accessibleWorkspacePdf(){
  const pdf=await PDFDocument.create(),page=pdf.addPage([520,720]);
  page.drawText('Accessible DocFlow workspace fixture',{x:36,y:660,size:18});
  const field=pdf.getForm().createTextField('AccessibleName');
  field.addToPage(page,{x:36,y:600,width:220,height:28});
  return Buffer.from(await pdf.save());
}

test('high-use PDF workspaces pass axe with a real document loaded',async({page})=>{
  test.setTimeout(180_000);
  const fixture=await accessibleWorkspacePdf();
  // Switching tools with a loaded PDF deliberately asks before discarding it.
  // Accept that guard here because each route's fixture is disposable.
  page.on('dialog',dialog=>dialog.accept());
  const routes=['preview','forms','redact-secure','ocr','sign-visual','organize','workflow','batch'];
  for(const tool of routes){
    await page.goto(base+'#/tools/'+tool);
    await expect(page.locator('[data-file-input]')).toBeVisible();
    await page.locator('[data-file-input]').setInputFiles({
      name:'accessible-workspace.pdf',mimeType:'application/pdf',buffer:fixture
    });
    await expect(page.locator('.df2-work')).toBeVisible();
    await expect(page.locator('[data-page-canvas]')).toBeVisible();
    const report=await new AxeBuilder({page})
      .withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice'])
      .analyze();
    expect(report.violations.map(v=>({
      tool,id:v.id,impact:v.impact,help:v.help,
      nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))
    }))).toEqual([]);
  }
});
