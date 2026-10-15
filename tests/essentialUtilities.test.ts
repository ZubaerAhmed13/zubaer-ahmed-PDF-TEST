import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { cropPdf, editMetadata, annotatePdf, signPdfVisually } from '../src/pdf/essentialEdits';
import { imagesToPdf } from '../src/pdf/core';
import type { InputFile, OperationProgress } from '../src/pdf/types';

const emit = (_update: OperationProgress): void => {};
async function fixture(): Promise<InputFile[]> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 800]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('Private text remains underneath crop and annotations', { x: 50, y: 700, size: 16, font });
  pdf.setTitle('A private sample');
  pdf.setAuthor('Original author');
  const buffer = await pdf.save();
  return [{ name: 'sample.pdf', type: 'application/pdf', buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer }];
}
async function reopen(bytes: ArrayBuffer): Promise<PDFDocument> { return PDFDocument.load(bytes); }

describe('essential PDF utilities', () => {
  it('crops page view without deleting the underlying content or changing media geometry', async () => {
    const result = await cropPdf(await fixture(), { left: 20, right: 40, top: 50, bottom: 30 }, emit);
    const pdf = await reopen(result.outputs[0]!.buffer);
    const page = pdf.getPage(0);
    expect(page.getCropBox()).toMatchObject({ x: 20, y: 30, width: 540, height: 720 });
    expect(page.getMediaBox()).toMatchObject({ width: 600, height: 800 });
  });
  it('refuses impossible crop bounds', async () => {
    await expect(cropPdf(await fixture(), { left: 450, right: 400, top: 0, bottom: 0 }, emit)).rejects.toThrow();
  });
  it('edits then clears the standard Info dictionary without claiming metadata sanitisation', async () => {
    let output = await editMetadata(await fixture(), { action: 'edit', title: 'Updated', author: 'New author', keywords: 'education, finance' }, emit);
    let pdf = await reopen(output.outputs[0]!.buffer);
    expect(pdf.getTitle()).toBe('Updated');
    expect(pdf.getAuthor()).toBe('New author');
    output = await editMetadata(await fixture(), { action: 'clear' }, emit);
    pdf = await reopen(output.outputs[0]!.buffer);
    expect(pdf.getTitle()).toBe('');
    expect(pdf.getAuthor()).toBe('');
  });
  it('adds visible annotations and typed signature as reopenable structural PDF pages', async () => {
    let result = await annotatePdf(await fixture(), { kind: 'highlight', posX: 15, posY: 20, markWidth: 60, markHeight: 10, color: '#ffdd22' }, emit);
    expect((await reopen(result.outputs[0]!.buffer)).getPageCount()).toBe(1);
    result = await annotatePdf(await fixture(), { kind: 'note', text: 'Follow up', posX: 15, posY: 20 }, emit);
    expect((await reopen(result.outputs[0]!.buffer)).getPageCount()).toBe(1);
    result = await signPdfVisually(await fixture(), { signatureText: 'A. Example', posX: 55, posY: 85 }, emit);
    expect((await reopen(result.outputs[0]!.buffer)).getPageCount()).toBe(1);
  });
  it('rejects a signature with no drawing or typed name', async () => {
    await expect(signPdfVisually(await fixture(), {}, emit)).rejects.toThrow();
  });
  it('converts images with controllable paper size and orientation', async () => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlRYpkAAAAASUVORK5CYII='), c => c.charCodeAt(0));
    const image: InputFile = { name: 'pixel.png', type: 'image/png', buffer: png.buffer };
    const result = await imagesToPdf([image], { pageSize: 'letter', orientation: 'landscape', margin: 10 }, emit);
    const page = (await reopen(result.outputs[0]!.buffer)).getPage(0);
    expect(page.getWidth()).toBe(792);
    expect(page.getHeight()).toBe(612);
  });
});
