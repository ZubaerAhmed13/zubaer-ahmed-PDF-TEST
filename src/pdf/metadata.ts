import { PDFDocument } from 'pdf-lib';
import { PdfOperationError } from './errors';
import type { InputFile, OperationProgress, OperationResult } from './types';

type Progress = (progress: OperationProgress) => void;

function ensurePdf(file: InputFile): void {
  const header = new Uint8Array(file.buffer, 0, Math.min(5, file.buffer.byteLength));
  if (new TextDecoder('ascii').decode(header) !== '%PDF-') {
    throw new PdfOperationError('INVALID_PDF', `${file.name} is not a valid PDF file.`);
  }
}

export async function metadata(files: InputFile[], _options: Record<string, unknown>, emit: Progress): Promise<OperationResult> {
  const file = files[0];
  if (!file) throw new PdfOperationError('INPUT_REQUIRED', 'Choose a PDF.');
  ensurePdf(file);
  try {
    const doc = await PDFDocument.load(file.buffer, { updateMetadata: false });
    const info = {
      title: doc.getTitle() ?? '',
      author: doc.getAuthor() ?? '',
      subject: doc.getSubject() ?? '',
      keywords: doc.getKeywords() ?? '',
      creator: doc.getCreator() ?? '',
      producer: doc.getProducer() ?? '',
      pageCount: doc.getPageCount(),
      encrypted: false,
      creationDate: doc.getCreationDate()?.toISOString() ?? '',
      modificationDate: doc.getModificationDate()?.toISOString() ?? ''
    };
    emit({ stage: 'finalizing', completed: 1, total: 1, percent: 100, message: 'Metadata read' });
    return { outputs: [], info };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/encrypt|password/i.test(message)) {
      throw new PdfOperationError('PASSWORD_REQUIRED', `${file.name} is encrypted or requires a password.`, message);
    }
    throw new PdfOperationError('INVALID_PDF', `${file.name} could not be parsed.`, message);
  }
}
