import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  fillForms,
  imagesToPdf,
  inspectForms,
  optimizePdf,
  rotatePdf
} from '../src/pdf/core';
import type { InputFile } from '../src/pdf/types';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function inputFromBytes(name: string, type: string, bytes: Uint8Array): InputFile {
  return { name, type, buffer: toArrayBuffer(bytes) };
}

async function pageFixture(name: string, pages: number): Promise<InputFile> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) {
    doc.addPage([300 + (index % 11), 400 + (index % 13)]);
  }
  return inputFromBytes(name, 'application/pdf', await doc.save());
}

async function extendedFormFixture(): Promise<InputFile> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([500, 700]);
  const form = doc.getForm();

  const text = form.createTextField('CustomerName');
  text.setText('Existing');
  text.addToPage(page, { x: 40, y: 620, width: 190, height: 24 });

  const notes = form.createTextField('Notes');
  notes.enableMultiline();
  notes.setText('Line one');
  notes.addToPage(page, { x: 40, y: 540, width: 240, height: 60 });

  const checkbox = form.createCheckBox('Accepted');
  checkbox.addToPage(page, { x: 40, y: 500, width: 20, height: 20 });

  const radio = form.createRadioGroup('Plan');
  radio.addOptionToPage('Basic', page, { x: 40, y: 455, width: 18, height: 18 });
  radio.addOptionToPage('Pro', page, { x: 90, y: 455, width: 18, height: 18 });
  radio.select('Basic');

  const dropdown = form.createDropdown('Country');
  dropdown.addOptions(['DE', 'BD']);
  dropdown.select('DE');
  dropdown.addToPage(page, { x: 40, y: 405, width: 140, height: 24 });

  const options = form.createOptionList('Skills');
  options.addOptions(['Excel', 'SAP', 'Jira']);
  options.select(['Excel']);
  options.addToPage(page, { x: 40, y: 300, width: 160, height: 80 });

  return inputFromBytes('extended-form.pdf', 'application/pdf', await doc.save());
}

const ignoreProgress = (): void => undefined;

describe('release certification coverage', () => {
  it('detects and fills text, multiline, checkbox, radio, dropdown, and option-list AcroForm fields', async () => {
    const input = await extendedFormFixture();
    const inspection = await inspectForms([input], {}, ignoreProgress);
    const fields = JSON.parse(String(inspection.info?.fields)) as Array<{ name: string; type: string; value: string }>;

    expect(fields.map(({ name, type }) => `${name}:${type}`)).toEqual([
      'CustomerName:text',
      'Notes:text',
      'Accepted:checkbox',
      'Plan:radio',
      'Country:dropdown',
      'Skills:option-list'
    ]);

    const values = {
      CustomerName: 'Zubaer',
      Notes: 'Updated\nmultiline value',
      Accepted: true,
      Plan: 'Pro',
      Country: 'BD',
      Skills: ['SAP', 'Jira']
    };
    const result = await fillForms([input], { values: JSON.stringify(values), flatten: false }, ignoreProgress);
    const output = await PDFDocument.load(result.outputs[0]!.buffer);
    const form = output.getForm();

    expect(form.getTextField('CustomerName').getText()).toBe('Zubaer');
    expect(form.getTextField('Notes').getText()).toBe('Updated\nmultiline value');
    expect(form.getCheckBox('Accepted').isChecked()).toBe(true);
    expect(form.getRadioGroup('Plan').getSelected()).toBe('Pro');
    expect(form.getDropdown('Country').getSelected()).toEqual(['BD']);
    expect(form.getOptionList('Skills').getSelected()).toEqual(['SAP', 'Jira']);
  });

  it('flattens AcroForm fields only when explicitly requested', async () => {
    const input = await extendedFormFixture();
    const result = await fillForms([input], { values: JSON.stringify({ CustomerName: 'Flattened' }), flatten: true }, ignoreProgress);
    const output = await PDFDocument.load(result.outputs[0]!.buffer);
    expect(output.getForm().getFields()).toHaveLength(0);
  });

  it('classifies XFA before attempting generic PDF parsing', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\n1 0 obj << /XFA 2 0 R >> endobj\n%%EOF');
    const input = inputFromBytes('xfa.pdf', 'application/pdf', bytes);
    await expect(inspectForms([input], {}, ignoreProgress)).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORM',
      message: expect.stringContaining('XFA')
    });
  });

  it('classifies malformed PDF data separately from a document with no fields', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\nthis is deliberately malformed');
    const input = inputFromBytes('broken.pdf', 'application/pdf', bytes);
    await expect(inspectForms([input], {}, ignoreProgress)).rejects.toMatchObject({ code: 'INVALID_PDF' });
  });

  it('embeds a PNG into a reopenable A4 PDF without changing the source image bytes first', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlRYpkAAAAASUVORK5CYII=', 'base64');
    const image = inputFromBytes('pixel.png', 'image/png', png);
    const result = await imagesToPdf([image], { margin: 24 }, ignoreProgress);
    const output = await PDFDocument.load(result.outputs[0]!.buffer);
    expect(output.getPageCount()).toBe(1);
    expect(output.getPage(0).getWidth()).toBeCloseTo(595.28, 2);
    expect(output.getPage(0).getHeight()).toBeCloseTo(841.89, 2);
  });

  it('preserves mixed page dimensions across a structural rotation', async () => {
    const input = await pageFixture('mixed.pdf', 12);
    const before = await PDFDocument.load(input.buffer);
    const dimensions = before.getPages().map((page) => [page.getWidth(), page.getHeight()]);
    const result = await rotatePdf([input], { target: 'even', degrees: 180 }, ignoreProgress);
    const output = await PDFDocument.load(result.outputs[0]!.buffer);
    expect(output.getPages().map((page) => [page.getWidth(), page.getHeight()])).toEqual(dimensions);
    expect(output.getPages().map((page) => page.getRotation().angle)).toEqual([0, 180, 0, 180, 0, 180, 0, 180, 0, 180, 0, 180]);
  });

  it('reopens a 300-page structurally optimized document with all pages intact', async () => {
    const input = await pageFixture('300-pages.pdf', 300);
    const result = await optimizePdf([input], {}, ignoreProgress);
    const output = await PDFDocument.load(result.outputs[0]!.buffer);
    expect(output.getPageCount()).toBe(300);
    expect(result.info?.structuralOnly).toBe(true);
  }, 30_000);
});
