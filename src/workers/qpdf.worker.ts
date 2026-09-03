import createQpdfModule, { type QpdfModule, type QpdfModuleInit } from '../vendor/qpdf/qpdf.js';
import type { InputFile, OperationProgress, OperationResult, OutputFile } from '../pdf/types';
import type { QpdfRequest, QpdfResponse } from '../pdf/qpdfTypes';

const scope = self as DedicatedWorkerGlobalScope;
const qpdfWasmUrl = new URL('../vendor/qpdf/qpdf.wasm', import.meta.url).toString();
const decoder = new TextDecoder();
const passwordEncoder = new TextEncoder();

type ExecResult = { exitCode: number; stdoutText: string; stderr: string };

function progress(requestId: string, stage: OperationProgress['stage'], percent: number, message: string): void {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  const response: QpdfResponse = {
    requestId,
    type: 'progress',
    progress: { stage, completed: value, total: 100, percent: value, message }
  };
  scope.postMessage(response);
}

function ensurePdf(file: InputFile): void {
  const header = new Uint8Array(file.buffer, 0, Math.min(5, file.buffer.byteLength));
  if (decoder.decode(header) !== '%PDF-') throw codedError('INVALID_PDF', `${file.name} is not a valid PDF file.`);
}

function validatePassword(password: string, operation: QpdfRequest['operation']): void {
  if (!password) throw codedError(operation === 'unlock' ? 'PASSWORD_REQUIRED' : 'INVALID_PASSWORD_FORMAT', 'Enter a password.');
  const byteLength = passwordEncoder.encode(password).byteLength;
  if (operation === 'protect' && byteLength < 8) throw codedError('INVALID_PASSWORD_FORMAT', 'Use a password with at least 8 UTF-8 bytes.');
  if (byteLength > 127) throw codedError('INVALID_PASSWORD_FORMAT', 'Password must be 127 UTF-8 bytes or fewer for PDF encryption compatibility.');
}

function codedError(code: string, message: string, detail?: string): Error & { code: string; detail?: string } {
  const error = new Error(message) as Error & { code: string; detail?: string };
  error.name = 'QpdfOperationError';
  error.code = code;
  if (detail) error.detail = detail;
  return error;
}

function normalizeFailure(error: unknown): { code: string; message: string; detail?: string } {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { code?: unknown; message?: unknown; detail?: unknown };
    if (typeof candidate.code === 'string' && typeof candidate.message === 'string') {
      return {
        code: candidate.code,
        message: candidate.message,
        ...(typeof candidate.detail === 'string' && candidate.detail ? { detail: candidate.detail } : {})
      };
    }
  }
  if (error instanceof Error) return { code: 'QPDF_OPERATION_FAILED', message: 'The qpdf operation could not be completed.', detail: error.message };
  return { code: 'QPDF_OPERATION_FAILED', message: 'The qpdf operation could not be completed.' };
}

function classifyQpdfFailure(detail: string, operation: QpdfRequest['operation']): Error & { code: string; detail?: string } {
  const normalized = detail.toLowerCase();
  if (/invalid password|incorrect password|password.*incorrect|supplied password.*wrong/.test(normalized)) {
    return codedError('INVALID_PASSWORD', 'The password is incorrect for this PDF.', detail);
  }
  if (/password.*required|requires.*password/.test(normalized)) {
    return codedError('PASSWORD_REQUIRED', 'This PDF requires a password.', detail);
  }
  if (/not a pdf|pdf header|damaged pdf|trailer dictionary|xref|cross-reference/.test(normalized)) {
    return codedError('INVALID_PDF', 'The PDF is malformed or cannot be processed safely.', detail);
  }
  return codedError('QPDF_OPERATION_FAILED', operation === 'protect' ? 'The PDF could not be encrypted.' : 'The PDF could not be unlocked.', detail);
}

function isExitStatus(error: unknown): error is { status: number } {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'ExitStatus' && typeof (error as { status?: unknown }).status === 'number';
}

function ownerPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function outputName(fileName: string, suffix: 'protected' | 'unlocked'): string {
  const stem = fileName.replace(/\.pdf$/i, '').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 96) || 'document';
  return `${stem}-${suffix}.pdf`;
}

function outputFile(name: string, bytes: Uint8Array): OutputFile {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return { name, type: 'application/pdf', buffer };
}

async function createJob(file: InputFile): Promise<{
  module: QpdfModule;
  inputPath: string;
  exec: (args: string[]) => ExecResult;
}> {
  const stdoutBytes: number[] = [];
  const stderrBytes: number[] = [];
  const moduleArg: QpdfModuleInit & { FS?: QpdfModule['FS'] } = {
    locateFile: (path) => path.endsWith('.wasm') ? qpdfWasmUrl : path,
    preRun: []
  };
  moduleArg.preRun = [() => {
    const fs = moduleArg.FS;
    if (!fs) throw new Error('qpdf MEMFS was not initialized.');
    fs.init(
      null,
      (byte) => { if (byte !== null) stdoutBytes.push(byte); },
      (byte) => { if (byte !== null) stderrBytes.push(byte); }
    );
  }];

  const module = await createQpdfModule(moduleArg);
  const dir = '/job';
  module.FS.mkdir(dir);
  const inputPath = `${dir}/input.pdf`;
  module.FS.writeFile(inputPath, new Uint8Array(file.buffer));

  const exec = (args: string[]): ExecResult => {
    stdoutBytes.length = 0;
    stderrBytes.length = 0;
    let exitCode = 0;
    try {
      exitCode = module.callMain(args);
    } catch (error) {
      if (isExitStatus(error)) exitCode = error.status;
      else throw error;
    }
    return {
      exitCode,
      stdoutText: decoder.decode(new Uint8Array(stdoutBytes)),
      stderr: decoder.decode(new Uint8Array(stderrBytes))
    };
  };

  return { module, inputPath, exec };
}

async function run(request: QpdfRequest): Promise<OperationResult> {
  ensurePdf(request.file);
  validatePassword(request.password, request.operation);
  progress(request.requestId, 'preparing', 8, 'Loading local qpdf 12.3.2 engine');
  const job = await createJob(request.file);
  progress(request.requestId, 'processing', 28, request.operation === 'protect' ? 'Encrypting PDF with AES-256' : 'Validating password and decrypting PDF');

  const outputPath = '/job/output.pdf';
  const execResult = request.operation === 'protect'
    ? job.exec(['--encrypt', request.password, ownerPassword(), '256', '--', job.inputPath, outputPath])
    : job.exec([`--password=${request.password}`, '--decrypt', job.inputPath, outputPath]);

  const detail = [execResult.stderr, execResult.stdoutText].filter(Boolean).join('\n').trim();
  const outputExists = job.module.FS.analyzePath(outputPath).exists;
  if ((execResult.exitCode !== 0 && execResult.exitCode !== 3) || !outputExists) throw classifyQpdfFailure(detail || `qpdf exited with code ${execResult.exitCode}.`, request.operation);

  progress(request.requestId, 'writing', 82, 'Reading encrypted PDF output from local memory');
  const bytes = job.module.FS.readFile(outputPath);
  const suffix = request.operation === 'protect' ? 'protected' : 'unlocked';
  const output = outputFile(outputName(request.file.name, suffix), bytes);
  progress(request.requestId, 'finalizing', 100, 'Complete');
  return {
    outputs: [output],
    info: {
      engine: 'qpdf 12.3.2 WASM',
      localProcessing: true,
      passwordPersisted: false,
      encryption: request.operation === 'protect' ? 'AES-256' : 'Removed',
      ...(execResult.exitCode === 3 && detail ? { warning: detail.slice(0, 500) } : {})
    }
  };
}

scope.addEventListener('message', (event: MessageEvent<QpdfRequest>) => {
  const request = event.data;
  void (async () => {
    try {
      const result = await run(request);
      const response: QpdfResponse = { requestId: request.requestId, type: 'result', result };
      scope.postMessage(response, result.outputs.map((output) => output.buffer));
    } catch (error) {
      const response: QpdfResponse = { requestId: request.requestId, type: 'error', error: normalizeFailure(error) };
      scope.postMessage(response);
    } finally {
      request.password = '';
    }
  })();
});
