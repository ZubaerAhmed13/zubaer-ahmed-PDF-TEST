export class PdfOperationError extends Error {
  constructor(public readonly code: string, message: string, public readonly detail?: string) {
    super(message);
    this.name = 'PdfOperationError';
  }
}

interface CodedPdfErrorLike {
  name: string;
  code: string;
  message: string;
  detail?: string;
}

function asCodedPdfError(error: unknown): CodedPdfErrorLike | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown; detail?: unknown };
  if (candidate.name !== 'PdfOperationError' || typeof candidate.code !== 'string' || candidate.code.length === 0 || typeof candidate.message !== 'string') return null;
  return {
    name: candidate.name,
    code: candidate.code,
    message: candidate.message,
    ...(typeof candidate.detail === 'string' && candidate.detail ? { detail: candidate.detail } : {})
  };
}

export function normalizePdfError(error: unknown): { code: string; message: string; detail?: string } {
  const coded = asCodedPdfError(error);
  if (coded) return { code: coded.code, message: coded.message, ...(coded.detail ? { detail: coded.detail } : {}) };
  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (lower.includes('encrypted') || lower.includes('password')) {
      return { code: 'PASSWORD_REQUIRED', message: 'This PDF is encrypted or requires a password.', detail: error.message };
    }
    return { code: 'PDF_OPERATION_FAILED', message: 'The PDF operation could not be completed.', detail: error.message };
  }
  return { code: 'PDF_OPERATION_FAILED', message: 'The PDF operation could not be completed.' };
}
