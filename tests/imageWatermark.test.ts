import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { addImageWatermark } from '../src/pdf/imageWatermark';
import type { InputFile } from '../src/pdf/types';

async function pdfInput(pageCount = 2): Promise<InputFile> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) doc.addPage([400 + index * 20, 600 + index * 20]);
  const bytes = await doc.save();
  return {
    name: 'fixture.pdf',
    type: 'application/pdf',
    buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  };
}

function pngInput(): InputFile {
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlRYpkAAAAASUVORK5CYII=', 'base64');
  return {
    name: 'mark.png',
    type: 'image/png',
    buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  };
}

describe('image watermark', () => {
  it('embeds a raster watermark without rasterizing the existing PDF pages', async () => {
    const result = await addImageWatermark(
      [await pdfInput(), pngInput()],
      { opacity: 0.4, imageWidthPercent: 30, imagePosition: 'bottom-right', imageMargin: 18, rotation: 0 },
      () => undefined
    );

    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0]!.name).toBe('watermarked-image.pdf');
    const reopened = await PDFDocument.load(result.outputs[0]!.buffer);
    expect(reopened.getPageCount()).toBe(2);
    const resources = reopened.getPage(0).node.Resources();
    const xObjects = resources?.lookup(PDFName.of('XObject'), PDFDict);
    expect(xObjects?.keys().length ?? 0).toBeGreaterThan(0);
  });

  it('reports a structured error when the watermark image is missing', async () => {
    await expect(addImageWatermark([await pdfInput(1)], {}, () => undefined)).rejects.toMatchObject({
      name: 'PdfOperationError',
      code: 'INVALID_WATERMARK_IMAGE'
    });
  });
});
