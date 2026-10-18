import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { inspectDocument } from '../src/pdf/documentInspection';
import { preservationConsequences } from '../src/pdf/preservationPolicy';
import { riskyCorpus } from './fixtures/r5Corpus';

describe('R5 document inspection and export consequences', () => {
  it('finds indirect active content, signatures and document structures without executing them', async () => {
    const report = await inspectDocument((await riskyCorpus()).buffer as ArrayBuffer);
    expect(report.pages).toBe(2);
    expect(report.signed).toBe(true);
    expect(report.certified).toBe(true);
    expect(report.activeContent).toContain('JavaScript');
    expect(report.riskyLinks).toBe(1);
    expect(report.features).toEqual(expect.arrayContaining(['fonts','annotations','links','outlines','page labels','forms','attachments','metadata','accessibility tags']));
  });
  it('does not claim an empty signature field is a signed document', async () => {
    const report = await inspectDocument((await riskyCorpus(true)).buffer as ArrayBuffer);
    expect(report.signed).toBe(false);
    expect(report.certified).toBe(false);
  });
  it('gives page-copy losses and whole-document active-content preservation consequences', async () => {
    const report = await inspectDocument((await riskyCorpus()).buffer as ArrayBuffer);
    expect(preservationConsequences('merge', report).join(' ')).toMatch(/bookmarks.*labels.*forms.*attachments/i);
    expect(preservationConsequences('rotate', report).join(' ')).toMatch(/preserve.*active content/i);
    expect(preservationConsequences('rotate', report).join(' ')).toMatch(/invalidat.*signature/i);
    expect(preservationConsequences('redact-secure', report).join(' ')).toMatch(/image.only.*text.*tags/i);
    expect(preservationConsequences('preview', report).join(' ')).toMatch(/never executed/i);
  });
  it('rejects malformed and budget-exceeding inputs instead of reporting clean', async () => {
    await expect(inspectDocument(new TextEncoder().encode('%PDF-1.7 broken').buffer)).rejects.toThrow();
    const doc = await PDFDocument.create(); doc.addPage([20000,100]);
    await expect(inspectDocument((await doc.save()).buffer as ArrayBuffer)).rejects.toThrow(/dimensions/i);
  });
});
