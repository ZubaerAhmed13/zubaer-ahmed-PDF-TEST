import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFString } from 'pdf-lib';

import { validateInputBudget } from './resourceBudget';
import { PdfOperationError } from './errors';
export interface DocumentInspection { pages: number; objects: number; features: string[]; signed: boolean; certified: boolean; activeContent: string[]; riskyLinks: number }
const name = (value: unknown): string => value instanceof PDFName ? value.decodeText() : '';
const text = (value: unknown): string => value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : '';

/** Structural inventory only: no action execution, attachment decoding, URI opening or signature validation. */
export async function inspectDocument(buffer: ArrayBuffer): Promise<DocumentInspection> {
  validateInputBudget([buffer.byteLength]);
  const doc = await PDFDocument.load(buffer, { updateMetadata: false, throwOnInvalidObject: true }).then(doc=>{doc.getPages();return doc;}).catch(error => {
    throw new PdfOperationError(/encrypt|password/i.test(String(error)) ? 'PASSWORD_REQUIRED' : 'INVALID_PDF', /encrypt|password/i.test(String(error)) ? 'This PDF is encrypted or requires a password.' : 'This PDF could not be parsed.');
  });
  const pages = doc.getPages();
  if (!pages.length || pages.length > 1000) throw new PdfOperationError('RESOURCE_LIMIT','This operation supports 1–1000 pages; split larger documents first.');
  for (const page of pages) {
    const { width, height } = page.getMediaBox();
    if (![width,height].every(n => Number.isFinite(n) && n > 0 && n <= 14400)) throw new PdfOperationError('RESOURCE_LIMIT','PDF page dimensions exceed the 14,400-point limit.');
  }
  const objects = doc.context.enumerateIndirectObjects();
  if (objects.length > 100000) throw new PdfOperationError('RESOURCE_LIMIT','PDF complexity exceeds the 100,000-object limit.');
  const features = new Set<string>();
  const active = new Set<string>();
  let signed = false, certified = false, riskyLinks = 0;
  let visited = 0;
  const seen = new Set<unknown>();
  const walk = (value: unknown): void => {
    if (seen.has(value)) return;
    if (!(value instanceof PDFDict || value instanceof PDFArray || value instanceof PDFRawStream)) return;
    seen.add(value);
    if (++visited > 250000) throw new PdfOperationError('RESOURCE_LIMIT','PDF nested structure exceeds the inspection limit.');
    if (value instanceof PDFRawStream) { walk(value.dict); return; }
    if (value instanceof PDFArray) { value.asArray().forEach(walk); return; }
    const get = (key: string) => doc.context.lookup(value.get(PDFName.of(key)));
    const has = (key: string) => value.has(PDFName.of(key));
    const type = name(get('Type')), subtype = name(get('Subtype')), action = name(get('S'));
    if (type === 'Font' || has('Font')) features.add('fonts');
    if (type === 'Annot' || has('Annots')) features.add('annotations');
    if (subtype === 'Link') features.add('links');
    if (has('Outlines')) features.add('outlines');
    if (has('PageLabels')) features.add('page labels');
    if (has('AcroForm')) features.add('forms');
    if (has('EmbeddedFiles') || type === 'EmbeddedFile') features.add('attachments');
    if (has('Metadata') || ['Title','Author','Subject','Keywords','Creator','Producer'].some(has)) features.add('metadata');
    if (has('StructTreeRoot')) features.add('accessibility tags');
    if (has('ByteRange') && has('Contents')) signed = true;
    if (has('DocMDP') || name(get('TransformMethod')) === 'DocMDP') certified = true;
    if (['JavaScript','Launch','GoToR','GoToE','SubmitForm','ImportData'].includes(action)) active.add(action);
    if (has('JS') || has('JavaScript')) active.add('JavaScript');
    if (has('AA')) active.add('additional actions');
    if (has('OpenAction')) active.add('open action');
    if (action === 'URI') {
      const uri = text(get('URI')).trim().split('').filter(c => c.charCodeAt(0)>32).join('');
      if (!/^https:\/\//i.test(uri)) riskyLinks++;
    }
    if (subtype === 'Image') {
      const w = get('Width'), h = get('Height');
      if (w instanceof PDFNumber && h instanceof PDFNumber && (!Number.isFinite(w.asNumber() * h.asNumber()) || w.asNumber() <= 0 || h.asNumber() <= 0 || w.asNumber() * h.asNumber() > 80_000_000))
        throw new PdfOperationError('RESOURCE_LIMIT','An embedded image exceeds the 80-million-pixel decode limit.');
    }
    value.values().forEach(walk);
  };
  walk(doc.catalog);
  objects.forEach(([,value]) => walk(value));
  return { pages: pages.length, objects: objects.length, features: [...features].sort(), signed, certified, activeContent: [...active].sort(), riskyLinks };
}
