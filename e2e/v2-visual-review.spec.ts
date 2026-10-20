import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { mkdir } from 'node:fs/promises';

const route='/zubaer-ahmed-PDF-TEST/';
const output='artifacts/v2/screens';
test('capture full desktop and mobile product experience for visual design QA',async({page},testInfo)=>{
  if(testInfo.project.name!=='chromium')test.skip();
  await mkdir(output,{recursive:true});
  await page.setViewportSize({width:1440,height:900});
  await page.goto(route+'#/');
  await expect(page.getByRole('heading',{name:/Every document/})).toBeVisible();
  await page.screenshot({path:output+'/01-home-desktop.png',fullPage:true,animations:'disabled'});
  await page.goto(route+'#/tools/merge');
  await page.screenshot({path:output+'/02-upload-desktop.png',fullPage:true,animations:'disabled'});
  const first=await PDFDocument.create();const proposal=first.addPage([400,530]);
  proposal.drawText('Project proposal',{x:35,y:465,size:24});proposal.drawText('Review the document, then export your result.',{x:35,y:425,size:12});
  const firstBytes=Buffer.from(await first.save());
  const second=await PDFDocument.create();second.addPage([500,680]).drawText('Appendix',{x:40,y:610,size:24});const secondBytes=Buffer.from(await second.save());
  await page.locator('[data-file-input]').setInputFiles([
    {name:'First document.pdf',mimeType:'application/pdf',buffer:firstBytes},
    {name:'Second document.pdf',mimeType:'application/pdf',buffer:secondBytes}
  ]);
  await expect(page.locator('.df2-file')).toHaveCount(2);
  await expect(page.locator('[data-page-label]')).toContainText('Page 1 / 1');
  await expect.poll(async()=>page.locator('[data-page-canvas]').evaluate((canvas:Element)=>(canvas as HTMLCanvasElement).width)).toBeGreaterThan(310);
  await page.screenshot({path:output+'/03-workspace-desktop.png',fullPage:true,animations:'disabled'});
  await page.locator('[data-run]').click();
  await expect(page.locator('.df2-result')).toBeVisible();
  await page.screenshot({path:output+'/04-result-desktop.png',fullPage:true,animations:'disabled'});

  await page.setViewportSize({width:390,height:844});
  page.once('dialog',dialog=>dialog.accept());
  await page.goto(route+'#/');
  await expect(page.getByRole('heading',{name:/Every document/})).toBeVisible();
  await page.screenshot({path:output+'/05-home-phone.png',fullPage:true,animations:'disabled'});
  await page.screenshot({path:output+'/05-home-phone-viewport.png',animations:'disabled'});
  await page.goto(route+'#/tools/merge');
  await page.screenshot({path:output+'/06-upload-phone.png',fullPage:true,animations:'disabled'});
  await page.locator('[data-file-input]').setInputFiles([
    {name:'First document.pdf',mimeType:'application/pdf',buffer:firstBytes},
    {name:'Second document.pdf',mimeType:'application/pdf',buffer:secondBytes}
  ]);
  await expect(page.locator('.df2-file')).toHaveCount(2);
  await expect(page.locator('[data-page-label]')).toContainText('Page 1 / 1');
  await expect.poll(async()=>page.locator('[data-page-canvas]').evaluate((canvas:Element)=>(canvas as HTMLCanvasElement).width)).toBeGreaterThan(310);
  await page.screenshot({path:output+'/07-workspace-phone.png',fullPage:true,animations:'disabled'});
  await page.locator('[data-mobile-options]').click();
  await page.screenshot({path:output+'/08-settings-phone.png',fullPage:false,animations:'disabled'});
});
