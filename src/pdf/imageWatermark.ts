import { PDFDocument, degrees } from 'pdf-lib';
import { PdfOperationError } from './errors';
import type { InputFile, OperationProgress, OperationResult, OutputFile } from './types';

type Progress = (progress: OperationProgress) => void;

function emitProgress(emit: Progress, completed: number, total: number, message: string): void {
  const safeTotal = Math.max(total, 1);
  emit({
    stage: completed >= total ? 'writing' : 'processing',
    completed,
    total,
    percent: Math.min(96, Math.round((completed / safeTotal) * 92) + 4),
    message
  });
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function pdfOutput(name: string, bytes: Uint8Array): OutputFile {
  return {
    name,
    type: 'application/pdf',
    buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  };
}

function ensurePdf(file: InputFile): void {
  const header = new Uint8Array(file.buffer, 0, Math.min(5, file.buffer.byteLength));
  if (new TextDecoder('ascii').decode(header) !== '%PDF-') {
    throw new PdfOperationError('INVALID_PDF', `${file.name} is not a valid PDF file.`);
  }
}

async function loadPdf(file: InputFile): Promise<PDFDocument> {
  ensurePdf(file);
  try {
    const doc = await PDFDocument.load(file.buffer, { updateMetadata: false });
    doc.getPageCount();
    return doc;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/encrypt|password/i.test(message)) {
      throw new PdfOperationError('PASSWORD_REQUIRED', `${file.name} is encrypted or requires a password.`, message);
    }
    throw new PdfOperationError('INVALID_PDF', `${file.name} could not be parsed.`, message);
  }
}

function positionFor(
  position: string,
  pageWidth: number,
  pageHeight: number,
  width: number,
  height: number,
  margin: number
): { x: number; y: number } {
  const left = margin;
  const centerX = (pageWidth - width) / 2;
  const right = pageWidth - width - margin;
  const bottom = margin;
  const centerY = (pageHeight - height) / 2;
  const top = pageHeight - height - margin;

  switch (position) {
    case 'top-left': return { x: left, y: top };
    case 'top': return { x: centerX, y: top };
    case 'top-right': return { x: right, y: top };
    case 'left': return { x: left, y: centerY };
    case 'right': return { x: right, y: centerY };
    case 'bottom-left': return { x: left, y: bottom };
    case 'bottom': return { x: centerX, y: bottom };
    case 'bottom-right': return { x: right, y: bottom };
    default: return { x: centerX, y: centerY };
  }
}

export async function addImageWatermark(
  files: InputFile[],
  options: Record<string, unknown>,
  emit: Progress
): Promise<OperationResult> {
  const pdfFile = files[0];
  const imageFile = files[1];
  if (!pdfFile) throw new PdfOperationError('INPUT_REQUIRED', 'Choose a PDF.');
  if (!imageFile) throw new PdfOperationError('INVALID_WATERMARK_IMAGE', 'Choose a PNG or JPEG watermark image.');

  const doc = await loadPdf(pdfFile);
  let image;
  try {
    if (imageFile.type === 'image/png' || imageFile.name.toLowerCase().endsWith('.png')) {
      image = await doc.embedPng(imageFile.buffer);
    } else if (/image\/(jpeg|jpg)/.test(imageFile.type) || /\.jpe?g$/i.test(imageFile.name)) {
      image = await doc.embedJpg(imageFile.buffer);
    } else {
      throw new PdfOperationError('INVALID_WATERMARK_IMAGE', `${imageFile.name} is not a supported PNG or JPEG image.`);
    }
  } catch (error) {
    if (error instanceof PdfOperationError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new PdfOperationError('INVALID_WATERMARK_IMAGE', `${imageFile.name} could not be decoded as a watermark image.`, detail);
  }

  const opacity = Math.max(0.05, Math.min(1, asNumber(options.opacity, 0.35)));
  const widthPercent = Math.max(5, Math.min(90, asNumber(options.imageWidthPercent, 25)));
  const rotation = Math.max(-180, Math.min(180, asNumber(options.rotation, 0)));
  const margin = Math.max(0, asNumber(options.imageMargin, 24));
  const position = asString(options.imagePosition, 'center');
  const pages = doc.getPages();

  pages.forEach((page, index) => {
    const widthScale = (page.getWidth() * (widthPercent / 100)) / image.width;
    const heightScale = (page.getHeight() * 0.9) / image.height;
    const scale = Math.min(widthScale, heightScale);
    const width = image.width * scale;
    const height = image.height * scale;
    const { x, y } = positionFor(position, page.getWidth(), page.getHeight(), width, height, margin);
    page.drawImage(image, {
      x,
      y,
      width,
      height,
      opacity,
      rotate: degrees(rotation)
    });
    emitProgress(emit, index + 1, pages.length, `Applied image watermark to page ${index + 1} of ${pages.length}`);
  });

  emit({ stage: 'writing', completed: pages.length, total: pages.length, percent: 97, message: 'Writing watermarked PDF' });
  const bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: true });
  emit({ stage: 'finalizing', completed: 1, total: 1, percent: 100, message: 'Image watermark complete' });
  return { outputs: [pdfOutput('watermarked-image.pdf', bytes)] };
}
