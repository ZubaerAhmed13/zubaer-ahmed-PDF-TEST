export type ProgressStage = 'preparing' | 'processing' | 'writing' | 'finalizing';

export interface OperationProgress {
  stage: ProgressStage;
  completed: number;
  total: number;
  percent: number;
  message: string;
}

export interface InputFile {
  name: string;
  type: string;
  buffer: ArrayBuffer;
}

export interface OutputFile {
  name: string;
  type: string;
  buffer: ArrayBuffer;
}

export interface OperationResult {
  outputs: OutputFile[];
  info?: Record<string, string | number | boolean | null>;
}

export type WorkerOperation =
  | 'merge'
  | 'split'
  | 'remove-pages'
  | 'extract-pages'
  | 'organize'
  | 'rotate'
  | 'page-numbers'
  | 'watermark'
  | 'images-to-pdf'
  | 'metadata'
  | 'forms-inspect'
  | 'forms-fill'
  | 'optimize';

export interface WorkerRequest {
  requestId: string;
  operation: WorkerOperation;
  files: InputFile[];
  options: Record<string, unknown>;
}

export type WorkerResponse =
  | { requestId: string; type: 'progress'; progress: OperationProgress }
  | { requestId: string; type: 'result'; result: OperationResult }
  | { requestId: string; type: 'error'; error: { code: string; message: string; detail?: string } };
