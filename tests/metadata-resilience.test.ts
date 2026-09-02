import { describe, expect, it } from 'vitest';
import { metadata } from '../src/pdf/core';
import type { InputFile } from '../src/pdf/types';

function corruptPdf(): InputFile {
  const bytes = new TextEncoder().encode('%PDF-1.7\nthis is deliberately not a parseable PDF structure\n%%EOF');
  return {
    name: 'corrupt.pdf',
    type: 'application/pdf',
    buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  };
}

describe('metadata malformed-document boundary', () => {
  it('classifies post-load structural failures as INVALID_PDF', async () => {
    await expect(metadata([corruptPdf()], {}, () => undefined)).rejects.toMatchObject({
      name: 'PdfOperationError',
      code: 'INVALID_PDF',
      message: 'corrupt.pdf could not be parsed.'
    });
  });
});
