import {
  PDFDocument, StandardFonts, rgb,
  type PDFPage, type PDFFont
} from 'pdf-lib';
import { PdfOperationError } from './errors';
import { parsePageSelection } from './pageRanges';
import type { InputFile, OperationProgress, OperationResult } from './types';

type Progress = (update: OperationProgress) => void;
type Options = Record<string, unknown>;

function text(options: Options, key: string, fallback = ''): string {
  return typeof options[key] === 'string' ? options[key] as string : fallback;
}
function number(options: Options, key: string, fallback: number, min: number, max: number): number {
  const value = typeof options[key] === 'number' ? options[key] : Number(options[key]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}
function progress(emit: Progress, index: number, length: number, message: string): void {
  emit({ stage: 'processing', completed: index, total: length, percent: Math.round(index / length * 100), message });
}
async function source(files: InputFile[]): Promise<PDFDocument> {
  const file = files[0];
  if (!file) throw new PdfOperationError('INPUT_REQUIRED', 'Select a PDF first.');
  if (new TextDecoder('ascii').decode(new Uint8Array(file.buffer, 0, Math.min(5, file.buffer.byteLength))) !== '%PDF-') {
    throw new PdfOperationError('INVALID_PDF', 'The selected file is not a PDF.');
  }
  try {
    const doc = await PDFDocument.load(file.buffer, { updateMetadata: false });
    doc.getPages();
    return doc;
  } catch (error) {
    const cause = error instanceof Error ? error.message : '';
    throw new PdfOperationError(/encrypt|password/i.test(cause) ? 'PASSWORD_REQUIRED' : 'INVALID_PDF', 'Unable to open this PDF in the editor.');
  }
}
function destination(name: string, buffer: Uint8Array): OperationResult {
  return { outputs: [{ name, type: 'application/pdf', buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer }] };
}
function pages(doc: PDFDocument, options: Options): PDFPage[] {
  const all = doc.getPages();
  const selector = text(options, 'pages').trim();
  if (!selector) return all;
  return parsePageSelection(selector, all.length).map((index) => all[index]!);
}
function save(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: true, updateFieldAppearances: true });
}
const color = (value: string): ReturnType<typeof rgb> => {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : '#efaa35';
  return rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
};

export async function cropPdf(files: InputFile[], options: Options, emit: Progress): Promise<OperationResult> {
  const doc = await source(files);
  const selected = pages(doc, options);
  if (!selected.length) throw new PdfOperationError('INVALID_RANGE', 'No pages selected.');
  const left = number(options, 'left', 0, 0, 5000);
  const right = number(options, 'right', 0, 0, 5000);
  const top = number(options, 'top', 0, 0, 5000);
  const bottom = number(options, 'bottom', 0, 0, 5000);
  if (left + right + top + bottom === 0) throw new PdfOperationError('INVALID_CROP', 'Enter at least one non-zero margin.');
  for (const [index, page] of selected.entries()) {
    const box = page.getCropBox();
    const width = box.width - left - right;
    const height = box.height - top - bottom;
    if (width < 18 || height < 18) throw new PdfOperationError('INVALID_CROP', 'Crop margins leave fewer than 18 points in one dimension.');
    // Alter the visible crop box only. Underlying material is NOT deleted or redacted.
    page.setCropBox(box.x + left, box.y + bottom, width, height);
    progress(emit, index + 1, selected.length, 'Set visible crop box');
  }
  return destination('cropped.pdf', await save(doc));
}

export async function editMetadata(files: InputFile[], options: Options, emit: Progress): Promise<OperationResult> {
  const doc = await source(files);
  const remove = options.action === 'clear';
  doc.setTitle(remove ? '' : text(options, 'title').slice(0, 512));
  doc.setAuthor(remove ? '' : text(options, 'author').slice(0, 512));
  doc.setSubject(remove ? '' : text(options, 'subject').slice(0, 512));
  doc.setKeywords(remove ? [] : text(options, 'keywords').split(',').map((word) => word.trim()).filter(Boolean).slice(0, 50));
  doc.setCreator(remove ? '' : text(options, 'creator').slice(0, 512));
  // Basic Info dictionary only; not a guarantee of XMP or hidden-metadata removal.
  if (remove) doc.setProducer('');
  progress(emit, 1, 1, remove ? 'Cleared standard properties' : 'Updated standard properties');
  return destination(remove ? 'properties-cleared.pdf' : 'properties-edited.pdf', await save(doc));
}

function markPosition(page: PDFPage, options: Options): { x: number; y: number; width: number; height: number } {
  const box = page.getCropBox();
  const x = number(options, 'posX', 12, 0, 100) / 100;
  const y = number(options, 'posY', 12, 0, 100) / 100;
  const width = Math.max(10, box.width * number(options, 'markWidth', 30, 2, 100) / 100);
  const height = Math.max(8, box.height * number(options, 'markHeight', 12, 1, 100) / 100);
  return {
    x: box.x + Math.min(x * box.width, Math.max(0, box.width - width)),
    y: box.y + Math.max(0, box.height - (y * box.height) - height),
    width, height
  };
}

export async function annotatePdf(files: InputFile[], options: Options, emit: Progress): Promise<OperationResult> {
  const doc = await source(files);
  const selected = pages(doc, options);
  const kind = text(options, 'kind', 'note');
  const caption = text(options, 'text').trim().slice(0, 700);
  if (!['note', 'highlight', 'rectangle'].includes(kind)) throw new PdfOperationError('INVALID_ANNOTATION', 'Choose a supported annotation type.');
  if (kind === 'note' && !caption) throw new PdfOperationError('INVALID_ANNOTATION', 'Write your note first.');
  const ink = color(text(options, 'color', '#efaa35'));
  const font: PDFFont | null = kind === 'note' ? await doc.embedFont(StandardFonts.Helvetica) : null;
  for (const [index, page] of selected.entries()) {
    const { x, y, width, height } = markPosition(page, options);
    if (kind === 'highlight') page.drawRectangle({ x, y, width, height, color: ink, opacity: 0.23 });
    if (kind === 'rectangle') page.drawRectangle({ x, y, width, height, borderColor: ink, borderWidth: 2, opacity: 1 });
    if (kind === 'note' && font) {
      const size = number(options, 'fontSize', 14, 7, 36);
      const lineHeight = size * 1.28;
      // Wrap into short visual lines without replacing underlying document text.
      const paragraphs = caption.split(/\r?\n/);
      let currentY = y + height - size;
      for (const paragraph of paragraphs) {
        const words = paragraph.split(/\s+/).filter(Boolean);
        let line = '';
        for (const word of words) {
          const next = line ? line + ' ' + word : word;
          if (font.widthOfTextAtSize(next, size) > width && line) {
            if (currentY >= y) page.drawText(line, { x, y: currentY, size, font, color: ink });
            currentY -= lineHeight;
            line = word;
          } else line = next;
        }
        if (line && currentY >= y) page.drawText(line, { x, y: currentY, size, font, color: ink });
        currentY -= lineHeight;
      }
    }
    progress(emit, index + 1, selected.length, 'Applied visual mark');
  }
  // PDF page content marks are not editable comments, text highlighting or redactions.
  return destination('annotated.pdf', await save(doc));
}

export async function signPdfVisually(files: InputFile[], options: Options, emit: Progress): Promise<OperationResult> {
  const doc = await source(files);
  const selected = pages(doc, options);
  const data = text(options, 'signaturePng');
  const typed = text(options, 'signatureText').trim().slice(0, 150);
  if (!data && !typed) throw new PdfOperationError('SIGNATURE_REQUIRED', 'Draw a signature or enter your name.');
  if (data && !/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(data)) throw new PdfOperationError('INVALID_SIGNATURE', 'Only canvas-drawn PNG signatures are supported.');
  if (data.length > 1_600_000) throw new PdfOperationError('INVALID_SIGNATURE', 'Signature drawing is too large.');
  const image = data ? await doc.embedPng(Uint8Array.from(atob(data.slice('data:image/png;base64,'.length)), (c) => c.charCodeAt(0))) : null;
  const font = !image ? await doc.embedFont(StandardFonts.TimesRomanItalic) : null;
  for (const [index, page] of selected.entries()) {
    const { x, y, width, height } = markPosition(page, options);
    if (image) {
      const size = image.scaleToFit(width, height);
      page.drawImage(image, { x, y: y + (height - size.height) / 2, width: size.width, height: size.height });
    } else if (font) {
      const size = Math.min(number(options, 'fontSize', 24, 10, 42), height * 0.8);
      page.drawText(typed, { x, y: y + (height - size) / 2, size, font, color: rgb(0.12, 0.18, 0.27), maxWidth: width });
    }
    progress(emit, index + 1, selected.length, 'Placed visual signature');
  }
  // Visual appearance only — NOT a qualified or certificate-backed digital signature.
  return destination('visually-signed.pdf', await save(doc));
}
