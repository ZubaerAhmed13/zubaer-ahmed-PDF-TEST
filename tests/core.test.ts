import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import {
  addPageNumbers,
  addWatermark,
  extractPages,
  fillForms,
  inspectForms,
  mergePdf,
  metadata,
  optimizePdf,
  organizePdf,
  removePages,
  rotatePdf,
  splitPdf
} from '../src/pdf/core';
import type { InputFile } from '../src/pdf/types';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function fixture(name: string, pages: number): Promise<InputFile> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) doc.addPage([300 + index, 400 + index]);
  const bytes = await doc.save();
  return { name, type: 'application/pdf', buffer: toArrayBuffer(bytes) };
}

async function formFixture(): Promise<InputFile> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 500]);
  const form = doc.getForm();
  const text = form.createTextField('CustomerName');
  text.setText('Existing');
  text.addToPage(page, { x: 40, y: 400, width: 180, height: 24 });
  const checkbox = form.createCheckBox('Accepted');
  checkbox.addToPage(page, { x: 40, y: 350, width: 20, height: 20 });
  const bytes = await doc.save();
  return { name: 'form.pdf', type: 'application/pdf', buffer: toArrayBuffer(bytes) };
}

const ignoreProgress = (): void => undefined;

describe('structural PDF operations', () => {
  it('merges and reopens with the expected page count', async () => {
    const result = await mergePdf([await fixture('a.pdf', 2), await fixture('b.pdf', 3)], {}, ignoreProgress);
    const output = await PDFDocument.load(result.outputs[0]!.buffer);
    expect(output.getPageCount()).toBe(5);
  });

  it('rotates pages structurally and reopens them', async () => {
    const result = await rotatePdf([await fixture('a.pdf', 2)], { target: 'all', degrees: 90 }, ignoreProgress);
    const output = await PDFDocument.load(result.outputs[0]!.buffer);
    expect(output.getPages().every((page) => page.getRotation().angle === 90)).toBe(true);
  });

  it('splits into independently reopenable PDF outputs inside the ZIP', async () => {
    const result = await splitPdf([await fixture('split.pdf', 3)], { mode: 'individual' }, ignoreProgress);
    const zip = await JSZip.loadAsync(result.outputs[0]!.buffer);
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual(['split-01.pdf', 'split-02.pdf', 'split-03.pdf']);
    for (const name of names) {
      const bytes = await zip.file(name)!.async('uint8array');
      const output = await PDFDocument.load(bytes);
      expect(output.getPageCount()).toBe(1);
    }
  });

  it('removes selected pages while preserving the remaining page geometry', async () => {
    const result = await removePages([await fixture('remove.pdf', 4)], { pages: '2,4' }, ignoreProgress);
    const output = await PDFDocument.load(result.outputs[0]!.buffer);
    expect(output.getPages().map((page) => page.getWidth())).toEqual([300, 302]);
  });

  it('extracts selected pages while preserving their original geometry', async () => {
    const result = await extractPages([await fixture('extract.pdf', 4)], { pages: '2-3' }, ignoreProgress);
    const output = await PDFDocument.load(result.outputs[0]!.buffer);
    expect(output.getPages().map((page) => page.getWidth())).toEqual([301, 302]);
  });

  it('refuses to remove every page from a document', async () => {
    await expect(removePages([await fixture('remove-all.pdf', 2)], { pages: '1-2' }, ignoreProgress)).rejects.toMatchObject({ code: 'EMPTY_DOCUMENT' });
  });

  it('reorders, omits, and duplicates pages deterministically', async () => {
    const result = await organizePdf([await fixture('organize.pdf', 3)], { order: '3,1,1' }, ignoreProgress);
    const output = await PDFDocument.load(result.outputs[0]!.buffer);
    expect(output.getPageCount()).toBe(3);
    expect(output.getPages().map((page) => page.getWidth())).toEqual([302, 300, 300]);
  });

  it('adds numbering without changing page count or dimensions', async () => {
    const input = await fixture('numbers.pdf', 2);
    const before = await PDFDocument.load(input.buffer);
    const dimensions = before.getPages().map((page) => [page.getWidth(), page.getHeight()]);
    const result = await addPageNumbers([input], { pages: '1-2', start: 1, format: 'page-total' }, ignoreProgress);
    const output = await PDFDocument.load(result.outputs[0]!.buffer);
    expect(output.getPageCount()).toBe(2);
    expect(output.getPages().map((page) => [page.getWidth(), page.getHeight()])).toEqual(dimensions);
  });

  it('adds a watermark and produces a valid reopenable PDF', async () => {
    const result = await addWatermark([await fixture('watermark.pdf', 2)], { text: 'TEST', opacity: 0.2 }, ignoreProgress);
    const output = await PDFDocument.load(result.outputs[0]!.buffer);
    expect(output.getPageCount()).toBe(2);
  });

  it('inspects and fills supported AcroForm fields and preserves editability', async () => {
    const input = await formFixture();
    const inspection = await inspectForms([input], {}, ignoreProgress);
    expect(inspection.info?.fieldCount).toBe(2);

    const result = await fillForms([input], { values: JSON.stringify({ CustomerName: 'Zubaer', Accepted: true }), flatten: false }, ignoreProgress);
    const output = await PDFDocument.load(result.outputs[0]!.buffer);
    const form = output.getForm();
    expect(form.getTextField('CustomerName').getText()).toBe('Zubaer');
    expect(form.getCheckBox('Accepted').isChecked()).toBe(true);
  });

  it('reads metadata without mutating the source', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.setTitle('DocFlow fixture');
    doc.setAuthor('Test author');
    const bytes = await doc.save();
    const input: InputFile = { name: 'metadata.pdf', type: 'application/pdf', buffer: toArrayBuffer(bytes) };
    const result = await metadata([input], {}, ignoreProgress);
    expect(result.info?.title).toBe('DocFlow fixture');
    expect(result.info?.author).toBe('Test author');
    expect(result.info?.pageCount).toBe(1);
    expect(result.info?.encrypted).toBe(false);
  });

  it('structurally optimizes and reopens without changing page count', async () => {
    const result = await optimizePdf([await fixture('optimize.pdf', 4)], {}, ignoreProgress);
    const output = await PDFDocument.load(result.outputs[0]!.buffer);
    expect(output.getPageCount()).toBe(4);
    expect(result.info?.structuralOnly).toBe(true);
  });
});
