/// <reference lib="webworker" />
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef } from 'pdf-lib';
import { PdfOperationError } from './errors';
import type { InputFile, OperationProgress, OperationResult, OutputFile } from './types';

type Progress = (progress: OperationProgress) => void;

interface EligibleImage {
  ref: PDFRef;
  stream: PDFRawStream;
  width: number;
  height: number;
}

const names = {
  Subtype: PDFName.of('Subtype'),
  Image: PDFName.of('Image'),
  Filter: PDFName.of('Filter'),
  DCTDecode: PDFName.of('DCTDecode'),
  ColorSpace: PDFName.of('ColorSpace'),
  DeviceRGB: PDFName.of('DeviceRGB'),
  BitsPerComponent: PDFName.of('BitsPerComponent'),
  Width: PDFName.of('Width'),
  Height: PDFName.of('Height'),
  SMask: PDFName.of('SMask'),
  Mask: PDFName.of('Mask'),
  ImageMask: PDFName.of('ImageMask'),
  Decode: PDFName.of('Decode'),
  DecodeParms: PDFName.of('DecodeParms'),
  Length: PDFName.of('Length')
};

function progress(emit: Progress, completed: number, total: number, message: string): void {
  const safeTotal = Math.max(total, 1);
  emit({
    stage: 'processing',
    completed,
    total: safeTotal,
    percent: Math.min(92, 8 + Math.round((completed / safeTotal) * 84)),
    message
  });
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function ensurePdf(file: InputFile): void {
  const header = new Uint8Array(file.buffer, 0, Math.min(5, file.buffer.byteLength));
  if (new TextDecoder('ascii').decode(header) !== '%PDF-') throw new PdfOperationError('INVALID_PDF', `${file.name} is not a valid PDF file.`);
}

async function loadPdf(file: InputFile): Promise<PDFDocument> {
  ensurePdf(file);
  try {
    const doc = await PDFDocument.load(file.buffer, { updateMetadata: false });
    doc.getPages();
    return doc;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/encrypt|password/i.test(message)) throw new PdfOperationError('PASSWORD_REQUIRED', `${file.name} is encrypted or requires a password.`, message);
    throw new PdfOperationError('INVALID_PDF', `${file.name} could not be parsed.`, message);
  }
}

function pdfOutput(name: string, bytes: Uint8Array): OutputFile {
  return { name, type: 'application/pdf', buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
}

function nameEquals(value: unknown, expected: PDFName): boolean {
  return value instanceof PDFName && value.asString() === expected.asString();
}

function eligibleImages(doc: PDFDocument): EligibleImage[] {
  const images: EligibleImage[] = [];
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const dict = object.dict;
    if (!nameEquals(dict.get(names.Subtype), names.Image)) continue;
    if (!nameEquals(dict.get(names.Filter), names.DCTDecode)) continue;
    if (!nameEquals(dict.get(names.ColorSpace), names.DeviceRGB)) continue;
    const bits = dict.lookupMaybe(names.BitsPerComponent, PDFNumber)?.asNumber() ?? 8;
    const width = dict.lookupMaybe(names.Width, PDFNumber)?.asNumber() ?? 0;
    const height = dict.lookupMaybe(names.Height, PDFNumber)?.asNumber() ?? 0;
    if (bits !== 8 || !Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) continue;
    if (dict.has(names.SMask) || dict.has(names.Mask) || dict.has(names.ImageMask) || dict.has(names.Decode) || dict.has(names.DecodeParms)) continue;
    const bytes = object.getContents();
    if (bytes.length < 1024 || bytes[0] !== 0xff || bytes[1] !== 0xd8) continue;
    images.push({ ref, stream: object, width, height });
  }
  return images;
}

function ownArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function reencodeJpeg(source: Uint8Array, width: number, height: number, maxDimension: number, quality: number): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    throw new PdfOperationError('IMAGE_RECOMPRESSION_UNAVAILABLE', 'This browser does not expose the worker-side image APIs required for professional JPEG recompression.');
  }
  const bitmap = await createImageBitmap(new Blob([ownArrayBuffer(source)], { type: 'image/jpeg' }));
  try {
    if (bitmap.width !== width || bitmap.height !== height) {
      throw new PdfOperationError('IMAGE_DIMENSION_MISMATCH', 'A JPEG image stream reported dimensions that do not match its decoded pixels; it was not safe to recompress.');
    }
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new PdfOperationError('CANVAS_CONTEXT_UNAVAILABLE', 'The browser could not create an offscreen 2D canvas for JPEG recompression.');
    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    const encoded = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    return { bytes: new Uint8Array(await encoded.arrayBuffer()), width: targetWidth, height: targetHeight };
  } finally {
    bitmap.close();
  }
}

export async function recompressPdfImages(files: InputFile[], options: Record<string, unknown>, emit: Progress): Promise<OperationResult> {
  const file = files[0];
  if (!file) throw new PdfOperationError('INPUT_REQUIRED', 'Choose a PDF to optimize.');
  const quality = Math.max(0.5, Math.min(0.95, asNumber(options.imageQuality, 0.78)));
  const maxDimension = Math.max(900, Math.min(5000, Math.round(asNumber(options.maxImageDimension, 2200))));
  const minimumSavingRatio = 0.98;

  emit({ stage: 'preparing', completed: 0, total: 1, percent: 4, message: 'Inspecting PDF image streams' });
  const doc = await loadPdf(file);
  const candidates = eligibleImages(doc);
  let recompressed = 0;
  let skipped = 0;
  let imageBytesBefore = 0;
  let imageBytesAfter = 0;

  if (!candidates.length) {
    emit({ stage: 'writing', completed: 1, total: 1, percent: 94, message: 'No safe RGB JPEG streams found; applying structural optimization only' });
  }

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    const original = candidate.stream.getContents();
    imageBytesBefore += original.length;
    progress(emit, index, candidates.length, `Recompressing JPEG image ${index + 1} of ${candidates.length}`);
    try {
      const encoded = await reencodeJpeg(original, candidate.width, candidate.height, maxDimension, quality);
      if (encoded.bytes.length < original.length * minimumSavingRatio) {
        const dict = candidate.stream.dict.clone(doc.context);
        dict.set(names.Filter, names.DCTDecode);
        dict.set(names.ColorSpace, names.DeviceRGB);
        dict.set(names.BitsPerComponent, PDFNumber.of(8));
        dict.set(names.Width, PDFNumber.of(encoded.width));
        dict.set(names.Height, PDFNumber.of(encoded.height));
        dict.delete(names.Length);
        doc.context.assign(candidate.ref, PDFRawStream.of(dict, encoded.bytes));
        imageBytesAfter += encoded.bytes.length;
        recompressed += 1;
      } else {
        imageBytesAfter += original.length;
        skipped += 1;
      }
    } catch (error) {
      if (error instanceof PdfOperationError && error.code === 'IMAGE_RECOMPRESSION_UNAVAILABLE') throw error;
      imageBytesAfter += original.length;
      skipped += 1;
    }
    progress(emit, index + 1, candidates.length, `Processed JPEG image ${index + 1} of ${candidates.length}`);
  }

  emit({ stage: 'writing', completed: 1, total: 1, percent: 96, message: 'Writing optimized PDF without rasterizing pages' });
  const bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: true });
  emit({ stage: 'finalizing', completed: 1, total: 1, percent: 100, message: 'Complete' });

  return {
    outputs: [pdfOutput('optimized.pdf', bytes)],
    info: {
      mode: 'Selective JPEG XObject recompression',
      pageRasterization: false,
      imageQuality: quality,
      maxImageDimension: maxDimension,
      eligibleImages: candidates.length,
      recompressedImages: recompressed,
      skippedImages: skipped,
      imageBytesBefore,
      imageBytesAfter,
      inputBytes: file.buffer.byteLength,
      outputBytes: bytes.byteLength
    }
  };
}
