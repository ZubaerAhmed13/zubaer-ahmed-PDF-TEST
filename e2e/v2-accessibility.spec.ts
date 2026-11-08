import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {PDFDocument} from 'pdf-lib';
const base='/zubaer-ahmed-PDF-TEST/';
async function audit(page:Page){const report=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']).analyze();expect(report.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))).toEqual([]);}
for(const width of [1440,320])test('v2 home accessibility at '+width+' pixels',async({page})=>{await page.setViewportSize({width,height:900});await page.goto(base);await expect(page.getByRole('heading',{name:/Every document/})).toBeVisible();await audit(page);});
test('v2 editing workspace has an accessible document title and controls',async({page})=>{const pdf=await PDFDocument.create();pdf.addPage([400,580]).drawText('Accessible document fixture',{x:20,y:500});await page.goto(base+'#/tools/edit-pdf');await page.locator('[data-file-input]').setInputFiles({name:'document.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});await expect(page.locator('[data-editor-add=text]')).toBeVisible();await audit(page);});
