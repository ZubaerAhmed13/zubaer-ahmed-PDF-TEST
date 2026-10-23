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
  | 'workflow-preflight'
  | 'document-inspect'
  | 'direct-edit'
  | 'direct-edit-inspect'
  | 'native-edit-inspect'
  | 'native-edit-preview'
  | 'merge'
  | 'split'
  | 'remove-pages'
  | 'extract-pages'
  | 'organize'
  | 'rotate'
  | 'page-numbers'
  | 'watermark'
  | 'watermark-image'
  | 'images-to-pdf'
  | 'metadata'
  | 'forms-inspect'
  | 'forms-fill'
  | 'crop'
  | 'metadata-edit'
  | 'annotate'
  | 'sign-visual'
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
