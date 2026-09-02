import JSZip from 'jszip';
import {
  PDFDocument,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
  degrees,
  rgb
} from 'pdf-lib';
import { PdfOperationError } from './errors';
import { parsePageOrder, parsePageSelection, parseSplitRanges } from './pageRanges';
import type { InputFile, OperationProgress, OperationResult, OutputFile } from './types';

type Progress = (progress: OperationProgress) => void;

const progress = (emit: Progress, stage: OperationProgress['stage'], completed: number, total: number, message: string): void => {
  const safeTotal = Math.max(total, 1);
  emit({ stage, completed, total, percent: Math.min(100, Math.round((completed / safeTotal) * 100)), message });
};

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
function pdfOutput(name: string, bytes: Uint8Array): OutputFile {
  return { name, type: 'application/pdf', buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
}
function ensurePdf(file: InputFile): void {
  const header = new Uint8Array(file.buffer, 0, Math.min(5, file.buffer.byteLength));
  if (new TextDecoder('ascii').decode(header) !== '%PDF-') throw new PdfOperationError('INVALID_PDF', `${file.name} is not a valid PDF file.`);
}
function isPdfOperationError(error: unknown): error is PdfOperationError {
  if (error instanceof PdfOperationError) return true;
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown };
  return candidate.name === 'PdfOperationError' && typeof candidate.code === 'string' && typeof candidate.message === 'string';
}
async function loadPdf(file: InputFile): Promise<PDFDocument> {
  ensurePdf(file);
  try {
    return await PDFDocument.load(file.buffer, { updateMetadata: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/encrypt|password/i.test(message)) throw new PdfOperationError('PASSWORD_REQUIRED', `${file.name} is encrypted or requires a password.`, message);
    throw new PdfOperationError('INVALID_PDF', `${file.name} could not be parsed.`, message);
  }
}
function getAcroForm(file: InputFile, doc: PDFDocument) {
  try {
    const form = doc.getForm();
    const fields = form.getFields();
    return { form, fields };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PdfOperationError('INVALID_PDF', `${file.name} contains a malformed AcroForm structure.`, message);
  }
}
async function savePdf(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: true });
}

export async function mergePdf(files: InputFile[], _options: Record<string, unknown>, emit: Progress): Promise<OperationResult> {
  if (files.length < 2) throw new PdfOperationError('INPUT_REQUIRED', 'Choose at least two PDFs to merge.');
  const output = await PDFDocument.create();
  progress(emit, 'preparing', 0, files.length, 'Preparing documents');
  for (let index = 0; index < files.length; index += 1) {
    const source = await loadPdf(files[index]!);
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach((page) => output.addPage(page));
    progress(emit, 'processing', index + 1, files.length, `Merged ${index + 1} of ${files.length} documents`);
  }
  progress(emit, 'writing', files.length, files.length, 'Writing merged PDF');
  return { outputs: [pdfOutput('merged.pdf', await savePdf(output))] };
}

export async function splitPdf(files: InputFile[], options: Record<string, unknown>, emit: Progress): Promise<OperationResult> {
  const file = files[0];
  if (!file) throw new PdfOperationError('INPUT_REQUIRED', 'Choose a PDF to split.');
  const source = await loadPdf(file);
  const total = source.getPageCount();
  const mode = asString(options.mode, 'ranges');
  let groups: number[][] = [];
  if (mode === 'individual') groups = source.getPageIndices().map((page) => [page]);
  else if (mode === 'every') {
    const every = Math.max(1, Math.floor(asNumber(options.every, 5)));
    for (let start = 0; start < total; start += every) groups.push(source.getPageIndices().slice(start, start + every));
  } else if (mode === 'selected') groups = [parsePageSelection(asString(options.pages), total)];
  else groups = parseSplitRanges(asString(options.ranges, `1-${total}`), total);
  const zip = new JSZip();
  for (let index = 0; index < groups.length; index += 1) {
    const output = await PDFDocument.create();
    const pages = await output.copyPages(source, groups[index]!);
    pages.forEach((page) => output.addPage(page));
    zip.file(`split-${String(index + 1).padStart(2, '0')}.pdf`, await savePdf(output));
    progress(emit, 'processing', index + 1, groups.length, `Prepared part ${index + 1} of ${groups.length}`);
  }
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { outputs: [{ name: 'split-pdf.zip', type: 'application/zip', buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer }] };
}

export async function removePages(files: InputFile[], options: Record<string, unknown>, emit: Progress): Promise<OperationResult> {
  const file = files[0];
  if (!file) throw new PdfOperationError('INPUT_REQUIRED', 'Choose a PDF.');
  const source = await loadPdf(file);
  const total = source.getPageCount();
  const remove = new Set(parsePageSelection(asString(options.pages), total));
  const keep = source.getPageIndices().filter((page) => !remove.has(page));
  if (!keep.length) throw new PdfOperationError('INVALID_PAGE_SELECTION', 'At least one page must remain.');
  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, keep);
  pages.forEach((page, index) => { output.addPage(page); progress(emit, 'processing', index + 1, pages.length, `Copied page ${index + 1} of ${pages.length}`); });
  return { outputs: [pdfOutput('pages-removed.pdf', await savePdf(output))] };
}

export async function extractPages(files: InputFile[], options: Record<string, unknown>, emit: Progress): Promise<OperationResult> {
  const file = files[0];
  if (!file) throw new PdfOperationError('INPUT_REQUIRED', 'Choose a PDF.');
  const source = await loadPdf(file);
  const selected = parsePageSelection(asString(options.pages), source.getPageCount());
  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, selected);
  pages.forEach((page, index) => { output.addPage(page); progress(emit, 'processing', index + 1, pages.length, `Extracted page ${index + 1} of ${pages.length}`); });
  return { outputs: [pdfOutput('extracted-pages.pdf', await savePdf(output))] };
}

export async function organizePages(files: InputFile[], options: Record<string, unknown>, emit: Progress): Promise<OperationResult> {
  const file = files[0];
  if (!file) throw new PdfOperationError('INPUT_REQUIRED', 'Choose a PDF.');
  const source = await loadPdf(file);
  const order = parsePageOrder(asString(options.order), source.getPageCount());
  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, order);
  pages.forEach((page, index) => { output.addPage(page); progress(emit, 'processing', index + 1, pages.length, `Placed page ${index + 1} of ${pages.length}`); });
  return { outputs: [pdfOutput('organized.pdf', await savePdf(output))] };
}

export async function rotatePages(files: InputFile[], options: Record<string, unknown>, emit: Progress): Promise<OperationResult> {
  const file = files[0];
  if (!file) throw new PdfOperationError('INPUT_REQUIRED', 'Choose a PDF.');
  const doc = await loadPdf(file);
  const pages = doc.getPages();
  const target = asString(options.target, 'all');
  const selected = target === 'selected' ? new Set(parsePageSelection(asString(options.pages), pages.length)) : null;
  const amount = asNumber(options.degrees, 90);
  pages.forEach((page, index) => {
    const shouldRotate = target === 'all' || (target === 'odd' && index % 2 === 0) || (target === 'even' && index % 2 === 1) || Boolean(selected?.has(index));
    if (shouldRotate) page.setRotation(degrees((page.getRotation().angle + amount) % 360));
    progress(emit, 'processing', index + 1, pages.length, `Processed page ${index + 1} of ${pages.length}`);
  });
  return { outputs: [pdfOutput('rotated.pdf', await savePdf(doc))] };
}

export async function addPageNumbers(files: InputFile[], options: Record<string, unknown>, emit: Progress): Promise<OperationResult> {
  const file = files[0];
  if (!file) throw new PdfOperationError('INPUT_REQUIRED', 'Choose a PDF.');
  const doc = await loadPdf(file);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const selected = asString(options.pages).trim() ? new Set(parsePageSelection(asString(options.pages), pages.length)) : null;
  const start = Math.max(1, Math.floor(asNumber(options.start, 1)));
  const fontSize = Math.max(6, Math.min(72, asNumber(options.fontSize, 11)));
  const margin = Math.max(4, asNumber(options.margin, 24));
  const format = asString(options.format, 'page-total');
  pages.forEach((page, index) => {
    if (!selected || selected.has(index)) {
      const number = start + index;
      const text = format === 'fraction' ? `${number} / ${pages.length}` : format === 'page' ? `Page ${number}` : format === 'number' ? String(number) : `Page ${number} of ${pages.length}`;
      const width = font.widthOfTextAtSize(text, fontSize);
      page.drawText(text, { x: (page.getWidth() - width) / 2, y: margin, size: fontSize, font, color: rgb(0.15, 0.15, 0.15) });
    }
    progress(emit, 'processing', index + 1, pages.length, `Numbered page ${index + 1} of ${pages.length}`);
  });
  return { outputs: [pdfOutput('numbered.pdf', await savePdf(doc))] };
}

export async function addWatermark(files: InputFile[], options: Record<string, unknown>, emit: Progress): Promise<OperationResult> {
  const file = files[0];
  if (!file) throw new PdfOperationError('INPUT_REQUIRED', 'Choose a PDF.');
  const doc = await loadPdf(file);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  const text = asString(options.text, 'CONFIDENTIAL');
  const opacity = Math.max(0.05, Math.min(1, asNumber(options.opacity, 0.18)));
  const rotation = asNumber(options.rotation, -35);
  const fontSize = Math.max(12, Math.min(120, asNumber(options.fontSize, 42)));
  pages.forEach((page, index) => {
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    page.drawText(text, { x: (page.getWidth() - textWidth) / 2, y: page.getHeight() / 2, size: fontSize, font, rotate: degrees(rotation), opacity, color: rgb(0.25, 0.25, 0.25) });
    progress(emit, 'processing', index + 1, pages.length, `Watermarked page ${index + 1} of ${pages.length}`);
  });
  return { outputs: [pdfOutput('watermarked.pdf', await savePdf(doc))] };
}

export async function imagesToPdf(files: InputFile[], options: Record<string, unknown>, emit: Progress): Promise<OperationResult> {
  if (!files.length) throw new PdfOperationError('INPUT_REQUIRED', 'Choose at least one JPEG or PNG image.');
  const doc = await PDFDocument.create();
  const margin = Math.max(0, asNumber(options.margin, 24));
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    let image;
    if (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')) image = await doc.embedPng(file.buffer);
    else if (/image\/(jpeg|jpg)/.test(file.type) || /\.jpe?g$/i.test(file.name)) image = await doc.embedJpg(file.buffer);
    else throw new PdfOperationError('UNSUPPORTED_IMAGE', `${file.name} is not a supported JPEG or PNG image.`);
    const maxW = 595.28 - margin * 2;
    const maxH = 841.89 - margin * 2;
    const scale = Math.min(maxW / image.width, maxH / image.height, 1);
    const width = image.width * scale;
    const height = image.height * scale;
    const page = doc.addPage([595.28, 841.89]);
    page.drawImage(image, { x: (page.getWidth() - width) / 2, y: (page.getHeight() - height) / 2, width, height });
    progress(emit, 'processing', index + 1, files.length, `Added image ${index + 1} of ${files.length}`);
  }
  return { outputs: [pdfOutput('images.pdf', await savePdf(doc))] };
}

function hasXfa(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder('latin1');
  const chunkSize = 1_048_576;
  const overlap = 32;
  for (let start = 0; start < bytes.length; start += chunkSize - overlap) {
    const end = Math.min(bytes.length, start + chunkSize);
    if (/\/XFA\b/.test(decoder.decode(bytes.subarray(start, end)))) return true;
    if (end === bytes.length) break;
  }
  return false;
}

export async function inspectForms(files: InputFile[], _options: Record<string, unknown>, emit: Progress): Promise<OperationResult> {
  const file = files[0];
  if (!file) throw new PdfOperationError('INPUT_REQUIRED', 'Choose a PDF form.');
  if (hasXfa(file.buffer)) throw new PdfOperationError('UNSUPPORTED_FORM', 'This PDF uses XFA forms, which are not currently editable in DocFlow.');
  const doc = await loadPdf(file);
  const { fields } = getAcroForm(file, doc);
  const fieldInfo = fields.map((field) => {
    let type = 'unknown';
    let value = '';
    if (field instanceof PDFTextField) { type = 'text'; value = field.getText() ?? ''; }
    else if (field instanceof PDFCheckBox) { type = 'checkbox'; value = String(field.isChecked()); }
    else if (field instanceof PDFRadioGroup) { type = 'radio'; value = field.getSelected() ?? ''; }
    else if (field instanceof PDFDropdown) { type = 'dropdown'; value = field.getSelected().join(', '); }
    else if (field instanceof PDFOptionList) { type = 'option-list'; value = field.getSelected().join(', '); }
    return { name: field.getName(), type, value };
  });
  progress(emit, 'finalizing', 1, 1, 'Form inspection complete');
  if (!fieldInfo.length) throw new PdfOperationError('NO_FORM_FIELDS', 'No supported AcroForm fields were detected.');
  return { outputs: [], info: { fields: JSON.stringify(fieldInfo), fieldCount: fieldInfo.length } };
}

export async function fillForms(files: InputFile[], options: Record<string, unknown>, emit: Progress): Promise<OperationResult> {
  const file = files[0];
  if (!file) throw new PdfOperationError('INPUT_REQUIRED', 'Choose a PDF form.');
  if (hasXfa(file.buffer)) throw new PdfOperationError('UNSUPPORTED_FORM', 'This PDF uses XFA forms, which are not currently editable in DocFlow.');
  const doc = await loadPdf(file);
  const { form, fields } = getAcroForm(file, doc);
  const rawValues = typeof options.values === 'string' ? options.values : '{}';
  let values: Record<string, unknown>;
  try { values = JSON.parse(rawValues) as Record<string, unknown>; } catch { throw new PdfOperationError('INVALID_FORM_VALUES', 'Form values must be valid JSON.'); }
  fields.forEach((field, index) => {
    const value = values[field.getName()];
    if (value === undefined) return;
    if (field instanceof PDFTextField) field.setText(String(value));
    else if (field instanceof PDFCheckBox) {
      if (asBoolean(value)) field.check();
      else field.uncheck();
    }
    else if (field instanceof PDFRadioGroup) field.select(String(value));
    else if (field instanceof PDFDropdown) field.select(String(value));
    else if (field instanceof PDFOptionList) field.select(Array.isArray(value) ? value.map(String) : [String(value)]);
    progress(emit, 'processing', index + 1, fields.length, `Updated field ${index + 1} of ${fields.length}`);
  });
  if (asBoolean(options.flatten, false)) form.flatten();
  return { outputs: [pdfOutput('filled-form.pdf', await savePdf(doc))] };
}

export async function metadata(files: InputFile[], _options: Record<string, unknown>, emit: Progress): Promise<OperationResult> {
  const file = files[0];
  if (!file) throw new PdfOperationError('INPUT_REQUIRED', 'Choose a PDF.');
  try {
    const doc = await loadPdf(file);
    const info = {
      title: doc.getTitle() ?? '',
      author: doc.getAuthor() ?? '',
      subject: doc.getSubject() ?? '',
      keywords: doc.getKeywords() ?? '',
      creator: doc.getCreator() ?? '',
      producer: doc.getProducer() ?? '',
      pageCount: doc.getPageCount(),
      encrypted: false,
      creationDate: doc.getCreationDate()?.toISOString() ?? '',
      modificationDate: doc.getModificationDate()?.toISOString() ?? ''
    };
    progress(emit, 'finalizing', 1, 1, 'Metadata read');
    return { outputs: [], info };
  } catch (error) {
    if (isPdfOperationError(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new PdfOperationError('INVALID_PDF', `${file.name} could not be parsed.`, message);
  }
}

export async function optimizePdf(files: InputFile[], _options: Record<string, unknown>, emit: Progress): Promise<OperationResult> {
  const file = files[0];
  if (!file) throw new PdfOperationError('INPUT_REQUIRED', 'Choose a PDF.');
  const doc = await loadPdf(file);
  progress(emit, 'writing', 1, 1, 'Writing structurally optimized PDF');
  const bytes = await savePdf(doc);
  return { outputs: [pdfOutput('optimized.pdf', bytes)], info: { structuralOnly: true, originalBytes: file.buffer.byteLength, outputBytes: bytes.byteLength } };
}
