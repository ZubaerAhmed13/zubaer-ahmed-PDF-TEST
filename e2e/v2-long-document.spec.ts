import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

test('large PDFs keep all pages addressable with lazy thumbnails and real output',async({page})=>{
  const input=await PDFDocument.create();
  for(let n=0;n<34;n++)input.addPage([300+n,480]);
  await page.goto('/zubaer-ahmed-PDF-TEST/#/tools/rotate');
  await page.locator('[data-file-input]').setInputFiles({
    name:'thirty-four-pages.pdf',mimeType:'application/pdf',buffer:Buffer.from(await input.save())
  });
  await expect(page.locator('.df2-thumb[data-page]')).toHaveCount(34);
  await page.getByRole('button',{name:'Select page 31'}).click();
  await expect(page.locator('[data-page-label]')).toContainText('Page 31 / 34');
  await page.locator('select[name="target"]').selectOption('selected');
  await expect(page.locator('input[name="pages"]')).toHaveValue('31');
  await page.locator('[data-run]').click();
  await expect(page.locator('.df2-result')).toBeVisible();
  const pending=page.waitForEvent('download');
  await page.locator('.df2-output').first().click();
  const file=await (await pending).path();
  if(!file)throw Error('Missing exported PDF');
  const output=await PDFDocument.load(await readFile(file));
  expect(output.getPageCount()).toBe(34);
  expect(output.getPage(29).getRotation().angle).toBe(0);
  expect(output.getPage(30).getRotation().angle).toBe(90);
  expect(output.getPage(31).getRotation().angle).toBe(0);
});

test('a crowded thumbnail viewport does not repeatedly evict still-visible pages',async({page})=>{
  // Force every page into the observer's visible set: this reproduces the
  // previous >32-visible-page thrash without relying on monitor dimensions.
  await page.addInitScript(()=>{
    class VisibleObserver {
      private targets=new Set<Element>();
      constructor(private readonly callback:IntersectionObserverCallback){}
      observe(target:Element):void{
        this.targets.add(target);
        queueMicrotask(()=>{
          if(!this.targets.has(target))return;
          this.callback([{target,isIntersecting:true,intersectionRatio:1} as IntersectionObserverEntry],this as unknown as IntersectionObserver);
        });
      }
      unobserve(target:Element):void{this.targets.delete(target);}
      disconnect():void{this.targets.clear();}
      takeRecords():IntersectionObserverEntry[]{return [];}
    }
    Object.defineProperty(window,'IntersectionObserver',{configurable:true,value:VisibleObserver});
  });
  const document=await PDFDocument.create();
  for(let index=0;index<40;index++)document.addPage([300+index,480]);
  await page.goto('/zubaer-ahmed-PDF-TEST/#/tools/rotate');
  await page.locator('[data-file-input]').setInputFiles({
    name:'crowded-thumbnail-view.pdf',mimeType:'application/pdf',buffer:Buffer.from(await document.save())
  });
  const canvases=page.locator('.df2-thumb canvas[data-thumbnail-state]');
  await expect(canvases).toHaveCount(40);
  const states=()=>canvases.evaluateAll(items=>items.reduce((totals,el)=>{
    const state=(el as HTMLElement).dataset.thumbnailState!;
    totals[state]=(totals[state]??0)+1;
    return totals;
  },{} as Record<string,number>));
  await expect.poll(states,{timeout:30000}).toEqual({done:32,idle:8});
  // The first visible thumbnail must not oscillate between done and idle.
  const first=canvases.first();
  await expect(first).toHaveAttribute('data-thumbnail-state','done');
  await page.waitForTimeout(350);
  await expect(states()).resolves.toEqual({done:32,idle:8});
  await expect(first).toHaveAttribute('data-thumbnail-state','done');
  await page.getByRole('button',{name:'Select page 40'}).click();
  await expect(page.locator('[data-page-label]')).toContainText('Page 40 / 40');
});
