import { PDFDocument } from 'pdf-lib';
import { PdfOperationError } from './errors';
import type { InputFile, OperationProgress, OperationResult } from './types';

interface FieldSpec {
  type: 'text' | 'checkbox' | 'dropdown';
  name: string; page: number;
  left: number; top: number; width: number; height: number;
  required?: boolean; choices?: string[];
}
const MAX_FIELDS = 40;

function validate(raw: unknown): FieldSpec[] {
  let parsed: unknown;
  try { parsed = JSON.parse(typeof raw === 'string' ? raw : '[]') as unknown; }
  catch { throw new PdfOperationError('INVALID_FORM_VALUES', 'Form field definitions must be valid JSON.'); }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > MAX_FIELDS) throw new PdfOperationError('INVALID_FORM_VALUES', 'Add 1–40 form fields.');
  const names = new Set<string>();
  return parsed.map((value: unknown, index): FieldSpec => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PdfOperationError('INVALID_FORM_VALUES', 'Invalid field definition.');
    const s = value as Partial<FieldSpec>;
    if (s.type !== 'text' && s.type !== 'checkbox' && s.type !== 'dropdown') throw new PdfOperationError('INVALID_FORM_VALUES', 'Unsupported field type.');
    const name = typeof s.name === 'string' ? s.name.trim() : '';
    if (!name || name.length > 80 || /[.\p{Cc}]/u.test(name) || names.has(name)) throw new PdfOperationError('INVALID_FORM_VALUES', 'Use unique 1–80 character field names without dots.');
    names.add(name);
    const coords = [s.left, s.top, s.width, s.height];
    if (!Number.isInteger(s.page) || !coords.every(x => typeof x === 'number' && Number.isFinite(x)) ||
      (s.left ?? -1) < 0 || (s.top ?? -1) < 0 || (s.width ?? 0) <= 0 || (s.height ?? 0) <= 0 ||
      (s.left ?? 100) + (s.width ?? 100) > 100 || (s.top ?? 100) + (s.height ?? 100) > 100)
      throw new PdfOperationError('INVALID_FORM_VALUES', 'Field ' + (index + 1) + ' has an invalid page or placement.');
    if (s.type === 'dropdown' && (!Array.isArray(s.choices) || !s.choices.length || s.choices.length > 25 ||
      s.choices.some(c => typeof c !== 'string' || !c.trim() || c.length > 60) || new Set(s.choices).size !== s.choices.length))
      throw new PdfOperationError('INVALID_FORM_VALUES', 'Dropdowns require 1–25 unique choices of up to 60 characters.');
    return { type:s.type, name, page:s.page!, left:s.left!, top:s.top!, width:s.width!, height:s.height!,
      required:s.required === true, ...(s.type === 'dropdown' ? {choices:s.choices} : {}) };
  });
}

function hasXfa(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer), decoder = new TextDecoder('latin1');
  for (let offset = 0; offset < bytes.length; offset += 1_048_544) {
    const end = Math.min(offset + 1_048_576, bytes.length);
    if (/\/XFA\b/.test(decoder.decode(bytes.subarray(offset, end)))) return true;
    if (end === bytes.length) break;
  }
  return false;
}

export async function createFormFields(
  files: InputFile[], options: Record<string, unknown>, emit: (p:OperationProgress) => void
): Promise<OperationResult> {
  const file = files[0];
  if (!file) throw new PdfOperationError('INPUT_REQUIRED', 'Choose a PDF to add fields.');
  if (new TextDecoder('ascii').decode(new Uint8Array(file.buffer, 0, Math.min(5, file.buffer.byteLength))) !== '%PDF-')
    throw new PdfOperationError('INVALID_PDF', 'Choose a valid PDF.');
  if (hasXfa(file.buffer)) throw new PdfOperationError('UNSUPPORTED_FORM', 'XFA forms are not supported.');
  const specs = validate(options.fieldDefinitions);
  let pdf: PDFDocument;
  try { pdf = await PDFDocument.load(file.buffer, { updateMetadata:false }); }
  catch { throw new PdfOperationError('INVALID_PDF', 'Unable to open the PDF. Unlock encrypted documents first.'); }
  const pages = pdf.getPages(), form = pdf.getForm();
  const existing = new Set(form.getFields().map(field => field.getName()));
  for (const [index, spec] of specs.entries()) {
    if (existing.has(spec.name)) throw new PdfOperationError('INVALID_FORM_VALUES', 'The field name already exists: ' + spec.name);
    existing.add(spec.name);
    if (spec.page < 1 || spec.page > pages.length) throw new PdfOperationError('INVALID_FORM_VALUES', 'Page ' + spec.page + ' does not exist.');
    const page = pages[spec.page - 1]!;
    const width = page.getWidth() * spec.width / 100, height = page.getHeight() * spec.height / 100;
    if (width < 12 || height < 12) throw new PdfOperationError('INVALID_FORM_VALUES', 'Field "' + spec.name + '" is smaller than 12 PDF points.');
    const rect = {x:page.getWidth() * spec.left / 100, y:page.getHeight() * (1 - (spec.top + spec.height) / 100), width, height};
    try {
      if (spec.type === 'text') {
        const field = form.createTextField(spec.name);
        if (spec.required) field.enableRequired();
        field.addToPage(page, rect);
      } else if (spec.type === 'checkbox') {
        const field = form.createCheckBox(spec.name);
        if (spec.required) field.enableRequired();
        field.addToPage(page, rect);
      } else {
        const field = form.createDropdown(spec.name);
        field.setOptions(spec.choices!);
        if (spec.required) field.enableRequired();
        field.addToPage(page, rect);
      }
    } catch (e) { throw new PdfOperationError('INVALID_FORM_VALUES', 'Cannot create ' + spec.name + ': ' + (e instanceof Error ? e.message : String(e))); }
    emit({stage:'processing',completed:index+1,total:specs.length,percent:Math.round((index+1)*85/specs.length),message:'Adding field ' + (index+1)});
  }
  const bytes = await pdf.save({useObjectStreams:true,updateFieldAppearances:true});
  emit({stage:'writing',completed:specs.length,total:specs.length,percent:100,message:'Form fields saved'});
  return {outputs:[{name:'form-fields-added.pdf',type:'application/pdf',buffer:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer}],info:{fieldsCreated:specs.length,pageCount:pages.length}};
}
