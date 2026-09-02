import { expect, test, type Locator, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

const appPath = '/zubaer-ahmed-PDF-TEST/';

async function supportedFormsFixture(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([520, 720]);
  const form = doc.getForm();

  const text = form.createTextField('CustomerName');
  text.setText('Existing');
  text.addToPage(page, { x: 40, y: 650, width: 200, height: 24 });

  const checkbox = form.createCheckBox('Accepted');
  checkbox.addToPage(page, { x: 40, y: 605, width: 20, height: 20 });

  const radio = form.createRadioGroup('Plan');
  radio.addOptionToPage('Basic', page, { x: 40, y: 555, width: 20, height: 20 });
  radio.addOptionToPage('Pro', page, { x: 80, y: 555, width: 20, height: 20 });
  radio.select('Basic');

  const dropdown = form.createDropdown('Country');
  dropdown.setOptions(['DE', 'BE', 'NL']);
  dropdown.select('DE');
  dropdown.addToPage(page, { x: 40, y: 490, width: 180, height: 28 });

  const optionList = form.createOptionList('Skills');
  optionList.setOptions(['Finance', 'PMO', 'Operations']);
  optionList.enableMultiselect();
  optionList.select(['Finance', 'PMO']);
  optionList.addToPage(page, { x: 40, y: 360, width: 180, height: 100 });

  return Buffer.from(await doc.save());
}

async function openForms(page: Page): Promise<Locator> {
  await page.getByLabel('Search tools').fill('acroform');
  const openButton = page.locator('#tool-grid [data-open-tool="forms"]');
  await expect(openButton).toHaveCount(1);
  await openButton.click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function downloadFilled(dialog: Locator, page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('link', { name: /^Download filled-form\.pdf/ }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error('Playwright did not expose a download path.');
  return readFile(path);
}

test.beforeEach(async ({ page }) => {
  await page.goto(appPath);
  await expect(page.getByRole('heading', { name: /Private PDF tools/ })).toBeVisible();
});

test('certifies all currently supported AcroForm field types through inspect, fill, export and reopen', async ({ page }) => {
  const dialog = await openForms(page);
  await dialog.locator('#workspace-file').setInputFiles({
    name: 'supported-form-fields.pdf',
    mimeType: 'application/pdf',
    buffer: await supportedFormsFixture()
  });

  await dialog.getByRole('button', { name: 'Inspect form fields' }).click();
  await expect(dialog.locator('#form-field-summary')).toContainText('5 supported field(s)');

  await dialog.locator('textarea[name="values"]').fill(JSON.stringify({
    CustomerName: 'Zubaer',
    Accepted: true,
    Plan: 'Pro',
    Country: 'BE',
    Skills: ['PMO', 'Operations']
  }));
  await dialog.getByRole('button', { name: 'Run Fill PDF forms' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Complete');

  const bytes = await downloadFilled(dialog, page);
  const output = await PDFDocument.load(bytes);
  const form = output.getForm();
  expect(form.getTextField('CustomerName').getText()).toBe('Zubaer');
  expect(form.getCheckBox('Accepted').isChecked()).toBe(true);
  expect(form.getRadioGroup('Plan').getSelected()).toBe('Pro');
  expect(form.getDropdown('Country').getSelected()).toEqual(['BE']);
  expect(form.getOptionList('Skills').getSelected().sort()).toEqual(['Operations', 'PMO']);
});

test('flattening applies values and removes interactive AcroForm fields from the reopened export', async ({ page }) => {
  const dialog = await openForms(page);
  await dialog.locator('#workspace-file').setInputFiles({
    name: 'flatten-form-fields.pdf',
    mimeType: 'application/pdf',
    buffer: await supportedFormsFixture()
  });
  await dialog.locator('textarea[name="values"]').fill(JSON.stringify({ CustomerName: 'Flattened', Plan: 'Pro', Country: 'NL' }));
  await dialog.locator('input[name="flatten"]').check();
  await dialog.getByRole('button', { name: 'Run Fill PDF forms' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Complete');

  const bytes = await downloadFilled(dialog, page);
  const output = await PDFDocument.load(bytes);
  expect(output.getPageCount()).toBe(1);
  expect(output.getForm().getFields()).toHaveLength(0);
});
