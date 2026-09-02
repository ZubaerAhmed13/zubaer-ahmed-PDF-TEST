import { describe, expect, it } from 'vitest';
import { PdfOperationError, normalizePdfError } from '../src/pdf/errors';

describe('normalizePdfError', () => {
  it('preserves native PdfOperationError codes and details', () => {
    expect(normalizePdfError(new PdfOperationError('INVALID_PDF', 'Could not parse PDF.', 'parser detail'))).toEqual({
      code: 'INVALID_PDF',
      message: 'Could not parse PDF.',
      detail: 'parser detail'
    });
  });

  it('preserves the stable PdfOperationError shape across module-instance boundaries', () => {
    const boundaryError = new Error('Could not parse PDF.') as Error & { code: string; detail: string };
    boundaryError.name = 'PdfOperationError';
    boundaryError.code = 'INVALID_PDF';
    boundaryError.detail = 'cross-module parser detail';

    expect(normalizePdfError(boundaryError)).toEqual({
      code: 'INVALID_PDF',
      message: 'Could not parse PDF.',
      detail: 'cross-module parser detail'
    });
  });

  it('keeps unrelated errors generic', () => {
    expect(normalizePdfError(new Error('unexpected implementation failure'))).toMatchObject({
      code: 'PDF_OPERATION_FAILED',
      message: 'The PDF operation could not be completed.'
    });
  });
});
