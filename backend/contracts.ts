/** Portable contracts shared by the browser, broker and isolated worker. */
export const NOTICE_VERSION = '2026-10-24';
export const LIMITS = Object.freeze({
  inputBytes: 25 * 1024 * 1024,
  outputBytes: 50 * 1024 * 1024,
  pages: 100,
  processingMs: 180_000,
  uploadMinutes: 30,
  outputMinutes: 30,
  ownerActive: 1,
  globalRunning: 2,
  dailyStarts: 10,
});
export type Operation = 'office-to-pdf' | 'compress' | 'ocr';
export type JobState = 'queued' | 'running' | 'cancelling' | 'cancelled' | 'completed' | 'failed' | 'expired';
export interface InputFile { name: string; type: string; size: number; sha256: string }
export interface CompressOptions { jpegQuality: number; dpi: number; maxImagePixels: number }
export interface OcrOptions { languages: ('eng' | 'deu')[]; deskew: boolean; rotate: boolean }
interface RequestBase { idempotencyKey: string; consent: { accepted: true; noticeVersion: string }; files: [InputFile] }
export type CreateJobRequest = RequestBase & (
  { operation: 'compress'; options: CompressOptions } |
  { operation: 'ocr'; options: OcrOptions } |
  { operation: 'office-to-pdf'; options: Record<string, never> }
);
export interface OutputFile extends InputFile { pages: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const OFFICE_TYPES: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
function object(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown ${label} field: ${key}`);
  return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer between ${min} and ${max}`);
  return value;
}
function bool(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`);
  return value;
}
function filename(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 180 || /[/\\:]/.test(value) || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || value.trim() !== value || value === '.' || value === '..') throw new Error('Invalid filename');
  return value;
}
function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error('Invalid SHA-256');
  return value;
}
export function parseCreateJobRequest(value: unknown): CreateJobRequest {
  const request = object(value, ['operation', 'idempotencyKey', 'consent', 'files', 'options'], 'request');
  if (typeof request.idempotencyKey !== 'string' || !UUID.test(request.idempotencyKey)) throw new Error('Invalid idempotency key');
  const consent = object(request.consent, ['accepted', 'noticeVersion'], 'consent');
  if (consent.accepted !== true || consent.noticeVersion !== NOTICE_VERSION) throw new Error('Current upload notice consent is required');
  if (!Array.isArray(request.files) || request.files.length !== 1) throw new Error('Exactly one input file is required');
  const source = object(request.files[0], ['name', 'type', 'size', 'sha256'], 'file');
  const name = filename(source.name), extension = name.split('.').pop()?.toLowerCase() ?? '';
  const operation = request.operation;
  if (typeof operation !== 'string' || !['office-to-pdf', 'compress', 'ocr'].includes(operation)) throw new Error('Unsupported operation');
  const mime = operation === 'office-to-pdf' ? OFFICE_TYPES[extension] : extension === 'pdf' ? 'application/pdf' : undefined;
  if (!mime || source.type !== mime) throw new Error('File extension and MIME must match the operation');
  const base: RequestBase = {
    idempotencyKey: request.idempotencyKey.toLowerCase(),
    consent: { accepted: true, noticeVersion: NOTICE_VERSION },
    files: [{ name, type: mime, size: integer(source.size, 1, LIMITS.inputBytes, 'Input size'), sha256: digest(source.sha256) }],
  };
  if (operation === 'compress') {
    const options = object(request.options, ['jpegQuality', 'dpi', 'maxImagePixels'], 'options');
    return { ...base, operation, options: {
      jpegQuality: integer(options.jpegQuality === undefined ? 85 : options.jpegQuality, 50, 95, 'JPEG quality'),
      dpi: integer(options.dpi === undefined ? 150 : options.dpi, 72, 300, 'DPI'),
      maxImagePixels: integer(options.maxImagePixels === undefined ? 2200 : options.maxImagePixels, 900, 5000, 'Maximum image dimension'),
    } };
  }
  if (operation === 'ocr') {
    const options = object(request.options, ['languages', 'deskew', 'rotate'], 'options');
    const languages = options.languages === undefined ? ['eng'] : options.languages;
    if (!Array.isArray(languages) || languages.length < 1 || languages.length > 2 || new Set(languages).size !== languages.length || languages.some(language => language !== 'eng' && language !== 'deu')) throw new Error('OCR languages must be unique eng/deu values');
    return { ...base, operation, options: { languages: [...languages] as OcrOptions['languages'], deskew: bool(options.deskew, true, 'Deskew'), rotate: bool(options.rotate, true, 'Rotate') } };
  }
  object(request.options, [], 'options');
  return { ...base, operation: 'office-to-pdf', options: {} };
}

/** Never let a claim turn the privileged worker into an arbitrary URL client. */
export function validateStorageUrl(value: unknown, projectUrl: string, objectPath: string, direction: 'download' | 'upload'): string {
  if (typeof value !== 'string') throw new Error('Invalid storage URL');
  const project = new URL(projectUrl), url = new URL(value);
  if (project.protocol !== 'https:' || project.pathname !== '/' || project.search || project.hash || project.username || project.password) throw new Error('Invalid project origin');
  if (objectPath.split('/').some(part => !part || part === '.' || part === '..' || !/^[a-zA-Z0-9._-]+$/.test(part))) throw new Error('Invalid object path');
  const prefix = direction === 'upload' ? '/storage/v1/object/upload/sign/' : '/storage/v1/object/sign/';
  if (url.protocol !== 'https:' || url.origin !== project.origin || url.username || url.password || url.hash || url.pathname !== prefix + objectPath || !url.searchParams.get('token') || [...url.searchParams.keys()].some(key => key !== 'token') || url.searchParams.getAll('token').length !== 1) throw new Error('Storage URL is outside the job scope');
  return value;
}
export function validateOutput(value: unknown): OutputFile {
  const output = object(value, ['name', 'type', 'size', 'sha256', 'pages'], 'output');
  const name = filename(output.name);
  if (name !== 'result.pdf' || output.type !== 'application/pdf') throw new Error('Output must be result.pdf with PDF MIME');
  return { name, type: 'application/pdf', size: integer(output.size, 8, LIMITS.outputBytes, 'Output size'), sha256: digest(output.sha256), pages: integer(output.pages, 1, LIMITS.pages, 'Output page count') };
}
const transitions: Record<JobState, readonly JobState[]> = {
  queued: ['running', 'cancelled', 'failed', 'expired'],
  running: ['completed', 'cancelling', 'failed', 'expired'],
  cancelling: ['cancelled', 'failed', 'expired'],
  cancelled: ['expired'], completed: ['expired'], failed: ['expired'], expired: [],
};
export function canTransition(from: string, to: string): boolean { return transitions[from as JobState]?.includes(to as JobState) ?? false; }
export function canPublishResult(job: { state: string; attempt: number; leaseUntil: string; expiresAt: string }, claimAttempt: number, now: number): boolean {
  return job.state === 'running' && Number.isSafeInteger(claimAttempt) && claimAttempt > 0 && job.attempt === claimAttempt && Number.isFinite(now) && Date.parse(job.leaseUntil) > now && Date.parse(job.expiresAt) > now;
}
