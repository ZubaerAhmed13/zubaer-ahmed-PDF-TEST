export class PdfOperationError extends Error {
  constructor(public readonly code: string, message: string, public readonly detail?: string) {
    super(message);
    this.name = 'PdfOperationError';
  }
}

export function normalizePdfError(error: unknown): { code: string; message: string; detail?: string } {
  if (error instanceof PdfOperationError) {
    return { code: error.code, message: error.message, ...(error.detail ? { detail: error.detail } : {}) };
  }
  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (lower.includes('encrypted') || lower.includes('password')) {
      return { code: 'PASSWORD_REQUIRED', message: 'This PDF is encrypted or requires a password.', detail: error.message };
    }
    return { code: 'PDF_OPERATION_FAILED', message: 'The PDF operation could not be completed.', detail: error.message };
  }
  return { code: 'PDF_OPERATION_FAILED', message: 'The PDF operation could not be completed.' };
}
