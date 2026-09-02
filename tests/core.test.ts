import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { mergePdf, rotatePdf } from '../src/pdf/core';
import type { InputFile } from '../src/pdf/types';

async function fixture(name: string, pages: number): Promise<InputFile> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) doc.addPage([300 + index, 400 + index]);
  const bytes = await doc.save();
  return { name, type: 'application/pdf', buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
}
const ignoreProgress = (): void => undefined;

describe('structural PDF operations', () => {
  it('merges without changing page count', async () => {
    const result = await mergePdf([await fixture('a.pdf', 2), await fixture('b.pdf', 3)], {}, ignoreProgress);
    const output = await PDFDocument.load(result.outputs[0]!.buffer);
    expect(output.getPageCount()).toBe(5);
  });
  it('rotates pages by metadata/transformation rather than rasterizing', async () => {
    const result = await rotatePdf([await fixture('a.pdf', 2)], { target: 'all', degrees: 90 }, ignoreProgress);
    const output = await PDFDocument.load(result.outputs[0]!.buffer);
    expect(output.getPages().every((page) => page.getRotation().angle === 90)).toBe(true);
  });
});
