import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

const base = '/zubaer-ahmed-PDF-TEST/';
async function source() {
  const pdf = await PDFDocument.create();
  pdf.addPage([600,800]);
  pdf.addPage([500,700]);
  return {name:'form-source.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())};
}
async function open(page:import('@playwright/test').Page) {
  await page.goto(base+'#/tools/forms');
  await page.locator('#workspace-file').setInputFiles(await source());
  await page.locator('select[name="formAction"]').selectOption('create');
  await expect(page.locator('#form-field-builder')).toBeVisible();
}
async function exportPdf(page:import('@playwright/test').Page):Promise<PDFDocument> {
  await page.locator('#run-operation').click();
  const result=page.locator('[data-result-page]');
  await expect(result).toBeVisible();
  const download=page.waitForEvent('download');
  await result.locator('a[download]').first().click();
  const path=await (await download).path();
  if(!path) throw new Error('Missing download path');
  return PDFDocument.load(await readFile(path));
}
test('new fields are real editable AcroForm widgets with correct pages and positions', async ({page})=>{
  await open(page);
  const builder=page.locator('#form-field-builder');
  await builder.getByRole('button',{name:'+ Text field'}).click();
  await builder.getByRole('button',{name:'+ Checkbox'}).click();
  await builder.getByRole('button',{name:'+ Dropdown'}).click();
  const cards=builder.locator('.df-builder-card');
  await cards.nth(0).getByLabel('Field name').fill('Customer');
  await cards.nth(1).getByLabel('Field name').fill('Approved');
  await cards.nth(1).getByLabel('Page').fill('2');
  await cards.nth(2).getByLabel('Field name').fill('Country');
  await cards.nth(2).getByLabel('Page').fill('2');
  await cards.nth(2).getByLabel('Dropdown choices · one per line').fill('DE\nBE\nNL');
  await cards.nth(0).getByLabel('Required field').check();
  const values=JSON.parse(await page.locator('textarea[name="fieldDefinitions"]').inputValue()) as Array<{name:string}>;
  expect(values.map(v=>v.name)).toEqual(['Customer','Approved','Country']);
  const pdf=await exportPdf(page);
  expect(pdf.getPageCount()).toBe(2);
  const form=pdf.getForm();
  expect(form.getFields().map(f=>f.getName())).toEqual(['Customer','Approved','Country']);
  expect(form.getTextField('Customer').isRequired()).toBe(true);
  expect(form.getCheckBox('Approved').isChecked()).toBe(false);
  expect(form.getDropdown('Country').getOptions()).toEqual(['DE','BE','NL']);
  const widget=form.getTextField('Customer').acroField.getWidgets()[0]!;
  const rect=widget.getRectangle();
  expect(rect.x).toBeGreaterThan(88); expect(rect.x).toBeLessThan(92);
  expect(rect.y).toBeGreaterThan(622); expect(rect.y).toBeLessThan(626);
  expect(rect.width).toBeGreaterThan(238); expect(rect.width).toBeLessThan(242);
});
test('field name collisions fail safely without creating an output',async ({page})=>{
  await open(page);
  const builder=page.locator('#form-field-builder');
  await builder.getByRole('button',{name:'+ Text field'}).click();
  await builder.getByRole('button',{name:'+ Text field'}).click();
  await builder.locator('.df-builder-card').nth(1).getByLabel('Field name').fill('Field1');
  await page.locator('#run-operation').click();
  await expect(page.locator('#error')).toContainText('unique');
  await expect(page.locator('[data-result-page]')).toBeHidden();
});
test('Fill existing fields remains the default workflow',async ({page})=>{
  await open(page);
  await page.locator('select[name="formAction"]').selectOption('fill');
  await expect(page.locator('#form-field-builder')).toBeHidden();
  await expect(page.locator('[data-inspect-form]')).toBeVisible();
  await expect(page.locator('textarea[name="values"]')).toHaveValue('{}');
});
