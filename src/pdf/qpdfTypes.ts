import type { InputFile, OperationProgress, OperationResult } from './types';

export type QpdfOperation = 'protect' | 'unlock';

export interface QpdfRequest {
  requestId: string;
  operation: QpdfOperation;
  file: InputFile;
  password: string;
}

export type QpdfResponse =
  | { requestId: string; type: 'progress'; progress: OperationProgress }
  | { requestId: string; type: 'result'; result: OperationResult }
  | { requestId: string; type: 'error'; error: { code: string; message: string; detail?: string } };
