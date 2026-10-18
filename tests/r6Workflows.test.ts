import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { DEFAULT_WORKFLOW_RECIPES, validateRecipe, validateStep } from '../src/workflows/workflowEngine';
import * as transfer from '../src/workflows/recipeTransfer';
import * as preflight from '../src/workflows/workflowPreflight';
import { riskyCorpus } from './fixtures/r5Corpus';
import { addWatermark, extractPages, rotatePdf } from '../src/pdf/core';
import { executeWorkflow, type WorkflowStarter } from '../src/workflows/workflowEngine';
import { outputFilename } from '../src/app/exportReview';

async function pdf(): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) doc.addPage([100, 150]);
  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
describe('R6 reusable jobs', () => {
  it('exports a versioned whitelist and imports an identical recipe without private extras', () => {
    const source = { ...DEFAULT_WORKFLOW_RECIPES[0]!, password: 'PRIVATE', filename: 'personal.pdf' };
    const json = transfer.exportRecipe(source);
    expect(JSON.parse(json)).toMatchObject({ format: 'docflow-workflow', version: 1 });
    expect(json).not.toContain('PRIVATE'); expect(json).not.toContain('personal.pdf');
    expect(transfer.importRecipe(json)).toEqual(validateRecipe(source));
    expect(transfer.exportRecipe(transfer.importRecipe(json))).toBe(json);
  });
  it('rejects unsupported versions, oversize input and bad page syntax', () => {
    expect(() => transfer.importRecipe('{"format":"docflow-workflow","version":99}')).toThrow(/version/i);
    expect(() => transfer.importRecipe(' '.repeat(65537))).toThrow(/64/i);
    expect(() => validateStep({ id: 'range', operation: 'remove-pages', options: { pages: '1,,2' } })).toThrow(/page/i);
    expect(() => validateStep({ id: 'range', operation: 'crop', options: { pages: '3-1' } })).toThrow(/page/i);
    expect(() => validateStep({ id: 'n', operation: 'page-numbers', options: { start: 1.5 } })).toThrow(/integer/i);
  });
  it('names outputs predictably and never accepts path traversal or unknown placeholders', () => {
    expect(transfer.workflowOutputName('My file.pdf', 2, '{name}-{index}-{recipe}', 'Review')).toBe('My-file-2-Review.pdf');
    expect(transfer.workflowOutputName('../../x.pdf', 1, '{name}-{index}', 'x')).not.toMatch(/[\\/]/);
    expect(() => transfer.workflowOutputName('x.pdf', 1, '{password}', 'x')).toThrow(/placeholder/i);
  });
  it('simulates ranges against the current intermediate page order without modifying the source', async () => {
    const input = await pdf(); const before = new Uint8Array(input).slice();
    const report = await preflight.preflightWorkflow(input, [
      { id: 'r', operation: 'remove-pages', options: { pages: '1' } },
      { id: 'e', operation: 'extract-pages', options: { pages: '2' } },
      { id: 'w', operation: 'watermark', options: { text: 'DRAFT', pages: '1' } }
    ]);
    expect(report.inputPages).toBe(3); expect(report.outputPages).toBe(1);
    expect(report.steps.map(step => step.affectedPages)).toEqual([1, 1, 1]);
    expect(report.steps[0]!.warnings.join(' ')).toMatch(/bookmarks/i);
    expect(new Uint8Array(input)).toEqual(before);
    await expect(preflight.preflightWorkflow(input, [
      { id: 'r', operation: 'remove-pages', options: { pages: '1-2' } },
      { id: 'n', operation: 'page-numbers', options: { pages: '2' } }
    ])).rejects.toThrow(/step 2/i);
  });
  it('rejects an empty result, cumulative impossible crops and unsupported watermark characters', async () => {
    await expect(preflight.preflightWorkflow(await pdf(), [{ id: 'r', operation: 'remove-pages', options: { pages: '1-3' } }])).rejects.toThrow(/remain/i);
    await expect(preflight.preflightWorkflow(await pdf(), [
      { id: 'a', operation: 'crop', options: { left: 30, right: 30, top: 0, bottom: 0 } },
      { id: 'b', operation: 'crop', options: { left: 15, right: 15, top: 0, bottom: 0 } }
    ])).rejects.toThrow(/step 2.*18/i);
    await expect(preflight.preflightWorkflow(await pdf(), [{ id: 'w', operation: 'watermark', options: { text: '你好' } }])).rejects.toThrow(/font|encod|character/i);
  });
  it('flags signatures, attachments and active content in each applicable preflight step', async () => {
    const input = await riskyCorpus();
    const report = await preflight.preflightWorkflow(input.buffer as ArrayBuffer, [{ id: 'rotate', operation: 'rotate', options: {} }]);
    const warnings = report.steps[0]!.warnings.join(' ');
    expect(warnings).toMatch(/invalidat.*signature/i); expect(warnings).toContain('JavaScript'); expect(warnings).toMatch(/embedded files/i);
  });
  it('uses the imported executed snapshot and produces the same repeat page geometry', async () => {
    const draft = validateRecipe({ id: 'repeat', name: 'Repeat', steps: [{ id: 'r', operation: 'rotate', options: { degrees: 90 } }, { id: 'e', operation: 'extract-pages', options: { pages: '2' } }] });
    const imported = transfer.importRecipe(transfer.exportRecipe(draft));
    draft.steps[0]!.options.degrees = 180;
    const start: WorkflowStarter = (operation, files, options, progress) => ({ result: operation === 'rotate' ? rotatePdf(files, options, progress) : extractPages(files, options, progress), cancel() {} });
    const results = [];
    for (let i = 0; i < 2; i++) results.push(await executeWorkflow({ name: 'same.pdf', type: 'application/pdf', buffer: await pdf() }, imported.steps, start, () => false, () => {}, () => {}));
    for (const result of results) {
      const doc = await PDFDocument.load(result.buffer); expect(doc.getPageCount()).toBe(1); expect(doc.getPage(0).getRotation().angle).toBe(90);
    }
  });
  it('limits watermark output to selected pages and preserves all pages', async () => {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const result = await addWatermark([{ name: 'three.pdf', type: 'application/pdf', buffer: await pdf() }], { text: 'ONLY SECOND', pages: '2', fontSize: 12, rotation: 0 }, () => {});
    const doc = await getDocument({ data: new Uint8Array(result.outputs[0]!.buffer), standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname }).promise;
    try {
      const texts: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) texts.push((await (await doc.getPage(i)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' '));
      expect(texts[0]).not.toContain('ONLY SECOND'); expect(texts[1]).toContain('ONLY SECOND'); expect(texts[2]).not.toContain('ONLY SECOND');
    } finally { await doc.destroy(); }
  });
  it('keeps output format extensions and removes path and control characters', () => {
    expect(outputFilename('My copy', 'rotated.pdf')).toBe('My copy.pdf');
    expect(outputFilename('REPORT.PDF', 'rotated.pdf')).toBe('REPORT.pdf');
    const name = outputFilename('../private\u0000/name', 'report.json');
    expect([...name].every(character => character.charCodeAt(0) >= 32 && !'/\\'.includes(character))).toBe(true);
    expect(outputFilename('...', 'result.zip')).toBe('document.zip');
  });
  it('preflight ignores inactive rotation ranges just like execution, and validates selected ranges', async () => {
    for (const target of ['all', 'odd', 'even']) {
      const report = await preflight.preflightWorkflow(await pdf(), [{ id: 'r', operation: 'rotate', options: { target, pages: '9', degrees: 90 } }]);
      expect(report.outputPages).toBe(3);
    }
    await expect(preflight.preflightWorkflow(await pdf(), [{ id: 'r', operation: 'rotate', options: { target: 'selected', pages: '9' } }])).rejects.toThrow(/page/i);
  });
});
