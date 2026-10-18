import { expect, it } from 'vitest';
import { PDFDocument, PDFName, rgb } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { preservationCorpus } from './fixtures/pdfCorpus';
import { addPageNumbers, addWatermark, extractPages, removePages, organizePdf, mergePdf, rotatePdf, splitPdf, fillForms, optimizePdf } from '../src/pdf/core';
import { cropPdf, annotatePdf, signPdfVisually, editMetadata } from '../src/pdf/essentialEdits';
import type { InputFile, OperationResult } from '../src/pdf/types';

it('measures fonts/vectors/annotations/links and catalog structures for fourteen PDF transformations', async () => {
  const source = await PDFDocument.load(await preservationCorpus());
  source.getPage(0).drawRectangle({ x: 10, y: 10, width: 30, height: 30, color: rgb(.2,.5,.7) });
  source.catalog.set(PDFName.of('StructTreeRoot'), source.context.obj({ Type: 'StructTreeRoot', K: [] }));
  const bytes = await source.save();
  const file: InputFile = { name: 'structure-corpus.pdf', type: 'application/pdf', buffer: bytes.buffer as ArrayBuffer };
  const noop = () => {};
  const cases: [string, Promise<OperationResult>, boolean][] = [
    ['merge', mergePdf([file,file],{},noop),true],
    ['split', splitPdf([file],{pages:'1',mode:'selected',individualPdfResults:true},noop),true],
    ['remove-pages', removePages([file],{pages:'2'},noop),true],
    ['extract-pages', extractPages([file],{pages:'1'},noop),true],
    ['organize', organizePdf([file],{order:'1,2'},noop),true],
    ['rotate', rotatePdf([file],{degrees:90},noop),false],
    ['page-numbers', addPageNumbers([file],{},noop),false],
    ['watermark', addWatermark([file],{text:'REVIEW'},noop),false],
    ['crop', cropPdf([file],{left:1,right:1,top:1,bottom:1},noop),false],
    ['annotate', annotatePdf([file],{kind:'rectangle'},noop),false],
    ['sign-visual', signPdfVisually([file],{signatureText:'Synthetic signer'},noop),false],
    ['metadata-edit', editMetadata([file],{title:'Changed title'},noop),false],
    ['forms-fill', fillForms([file],{values:JSON.stringify({Name:'New value'})},noop),false],
    ['optimize-structure', optimizePdf([file],{},noop),false]
  ];
  const observations: Record<string,unknown> = {};
  for (const [operation,pending,copy] of cases) {
    const output = (await pending).outputs[0]!.buffer;
    const pdf = await PDFDocument.load(output);
    const reader = await getDocument({data:new Uint8Array(output.slice(0)), isEvalSupported:false}).promise;
    try {
      const page = await reader.getPage(1), content = await page.getTextContent();
      expect(content.items.some(item => 'str' in item && item.str.includes('First page retained text')),operation).toBe(true);
      const operators = await page.getOperatorList();
      expect(operators.fnArray.includes(OPS.constructPath),operation).toBe(true);
      const annotations = await page.getAnnotations();
      expect(annotations.some(a => a.subtype === 'Link' && a.url === 'https://example.org/'),operation).toBe(true);
      const catalog = Object.fromEntries(['Outlines','PageLabels','Names','AcroForm','StructTreeRoot'].map(key => [key,pdf.catalog.has(PDFName.of(key))]));
      for (const [key,present] of Object.entries(catalog)) expect(present, operation+':'+key).toBe(!copy);
      if (!copy) {
        expect((await reader.getOutline())?.[0]?.title,operation).toBe('First section');
        expect(await reader.getPageLabels(),operation).toEqual(['i','ii']);
        expect(Object.keys(await reader.getAttachments() ?? {}),operation).toEqual(['example.txt']);
        expect(pdf.getForm().getFields().length,operation).toBe(1);
      }
      observations[operation] = { selectableText:true, vectorPath:true, externalLink:true, catalog, originalTitle:pdf.getTitle() === source.getTitle(), tagSemanticsValidated:false };
    } finally { await reader.destroy(); }
  }
  mkdirSync('artifacts/r5',{recursive:true});
  writeFileSync('artifacts/r5/preservation.json',JSON.stringify({corpus:'synthetic-structure-v2',observations},null,2));
});
