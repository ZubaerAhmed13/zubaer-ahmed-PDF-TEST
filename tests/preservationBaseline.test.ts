import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { rotatePdf, mergePdf, extractPages, removePages, organizePdf } from '../src/pdf/core';
import type { InputFile } from '../src/pdf/types';
import { preservationCorpus, repairCorpus } from './fixtures/pdfCorpus';
import { mkdirSync, writeFileSync } from 'node:fs';

function input(bytes: Buffer): InputFile {
  return { name: 'synthetic-corpus.pdf', type: 'application/pdf', buffer: new Uint8Array(bytes).buffer };
}
const ignoreProgress = (): void => {};
describe('corpus v1 structural preservation baseline', () => {
  it('retains whole-document catalog structures and form values through rotation', async () => {
    const result = await rotatePdf([input(await preservationCorpus())], { degrees: 90, target: 'all' }, ignoreProgress);
    const doc = await PDFDocument.load(result.outputs[0]!.buffer);
    expect(doc.getPages().map(page => page.getRotation().angle)).toEqual([90, 90]);
    expect(doc.getForm().getTextField('Name').getText()).toBe('Synthetic value');
    expect(doc.getTitle()).toBe('DocFlow corpus v1 private title');
    for (const key of ['Outlines', 'PageLabels', 'Names', 'AcroForm'])
      expect(doc.catalog.has(PDFName.of(key)), key).toBe(true);
  });
  it('retains selected-page text and geometry through page-copy operations', async () => {
    const source = input(await preservationCorpus());
    const operations = [
      ['merge', await mergePdf([source, source], {}, ignoreProgress), 4],
      ['extract', await extractPages([source], { pages: '2' }, ignoreProgress), 1],
      ['remove', await removePages([source], { pages: '1' }, ignoreProgress), 1],
      ['organize', await organizePdf([source], { order: '2,1' }, ignoreProgress), 2]
    ] as const;
    const observations: Record<string, Record<string, boolean>> = {};
    for (const [name, result, count] of operations) {
      const doc = await PDFDocument.load(result.outputs[0]!.buffer);
      expect(doc.getPageCount()).toBe(count);
      const reader = await getDocument({ data: new Uint8Array(result.outputs[0]!.buffer.slice(0)) }).promise;
      try {
        const content = await (await reader.getPage(name === 'merge' ? 2 : 1)).getTextContent();
        expect(content.items.map(item => 'str' in item ? item.str : '').join(' ')).toContain('Second page retained text');
      } finally { await reader.destroy(); }
      observations[name] = Object.fromEntries(['Outlines', 'PageLabels', 'Names', 'AcroForm'].map(key => [key, doc.catalog.has(PDFName.of(key))]));
    }
    // Observations, not required losses: a future preservation improvement may turn these true.
    mkdirSync('artifacts/r0', { recursive: true });
    writeFileSync('artifacts/r0/preservation.json', JSON.stringify({ corpus: 1, observations }, null, 2));
  });
  it('provides a healthy control with a correct xref for the damaged repair fixtures', async () => {
    const doc = await getDocument({ data: new Uint8Array(repairCorpus()), stopAtErrors: true }).promise;
    try {
      expect(doc.numPages).toBe(1);
      expect((await doc.getPage(1)).getViewport({ scale: 1 }).width).toBe(320);
    } finally { await doc.destroy(); }
  });
});
