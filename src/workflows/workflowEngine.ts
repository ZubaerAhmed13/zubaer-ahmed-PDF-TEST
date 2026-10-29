import type { InputFile, OutputFile, OperationProgress, WorkerOperation } from '../pdf/types';
import type { RunningOperation } from '../pdf/workerClient';

export const WORKFLOW_OPERATIONS = [
  { id: 'rotate', label: 'Rotate pages', description: 'Change page orientation without rasterising.' },
  { id: 'page-numbers', label: 'Add page numbers', description: 'Stamp configurable page numbers.' },
  { id: 'watermark', label: 'Text watermark', description: 'Add a transparent text watermark.' },
  { id: 'crop', label: 'Crop visible area', description: 'Hide margins; does not erase hidden content.' },
  { id: 'metadata-edit', label: 'Edit PDF properties', description: 'Update standard PDF Info metadata.' },
  { id: 'remove-pages', label: 'Remove pages', description: 'Permanently omit selected pages from the exported copy.' },
  { id: 'extract-pages', label: 'Keep selected pages', description: 'Create one PDF containing just the selected pages.' },
  { id: 'optimize', label: 'Optimise PDF', description: 'Recompress supported JPEG images when safe.' }
] as const;

export type WorkflowOperation = typeof WORKFLOW_OPERATIONS[number]['id'];
export interface WorkflowStep {
  id: string;
  operation: WorkflowOperation;
  options: Record<string, string | number | boolean>;
}
export interface WorkflowRecipe {
  id: string;
  name: string;
  steps: WorkflowStep[];
}
export interface WorkflowProgress {
  step: number;
  totalSteps: number;
  percent: number;
  message: string;
}
export type WorkflowStarter = (
  operation: WorkerOperation,
  files: InputFile[],
  options: Record<string, unknown>,
  progress: (event: OperationProgress) => void
) => RunningOperation;

const OP_IDS = new Set<string>(WORKFLOW_OPERATIONS.map((item) => item.id));
export const MAX_STEPS = 8;
export const MAX_RECIPES = 15;
export const MAX_FILES = 20;
export const MAX_BATCH_BYTES = 150 * 1024 * 1024;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const STORAGE_KEY = 'docflow.workflow-recipes.v1';

export const DEFAULT_WORKFLOW_RECIPES: WorkflowRecipe[] = [
  { id: 'built-in-sharing', name: 'Prepare for sharing', steps: [
    { id: 'share-number', operation: 'page-numbers', options: { format: 'page-total', start: 1, fontSize: 11, margin: 24 } },
    { id: 'share-optimize', operation: 'optimize', options: {} }
  ] },
  { id: 'built-in-review', name: 'Internal review copy', steps: [
    { id: 'review-watermark', operation: 'watermark', options: { text: 'DRAFT', opacity: 0.18, rotation: -35, fontSize: 42 } },
    { id: 'review-number', operation: 'page-numbers', options: { format: 'page-total', start: 1, margin: 24, fontSize: 11 } }
  ] }
];

type Kind = 'string' | 'number' | 'boolean';
interface FieldRule { kind: Kind; default?: string | number | boolean; min?: number; max?: number; maxLength?: number; values?: readonly string[] }
const rules: Record<WorkflowOperation, Record<string, FieldRule>> = {
  rotate: {
    target: { kind: 'string', default: 'all', values: ['all', 'odd', 'even', 'selected'] },
    pages: { kind: 'string', default: '', maxLength: 180 },
    degrees: { kind: 'number', default: 90, min: 90, max: 270 }
  },
  'page-numbers': {
    pages: { kind: 'string', default: '', maxLength: 180 },
    start: { kind: 'number', default: 1, min: 1, max: 9999 },
    format: { kind: 'string', default: 'page-total', values: ['page-total', 'fraction', 'page', 'number'] },
    fontSize: { kind: 'number', default: 11, min: 6, max: 72 },
    margin: { kind: 'number', default: 24, min: 4, max: 200 }
  },
  watermark: {
    pages: { kind: 'string', default: '', maxLength: 180 },
    text: { kind: 'string', default: 'CONFIDENTIAL', maxLength: 180 },
    opacity: { kind: 'number', default: 0.18, min: 0.05, max: 1 },
    rotation: { kind: 'number', default: -35, min: -180, max: 180 },
    fontSize: { kind: 'number', default: 42, min: 12, max: 120 }
  },
  crop: {
    pages: { kind: 'string', default: '', maxLength: 180 },
    left: { kind: 'number', default: 24, min: 0, max: 5000 },
    right: { kind: 'number', default: 24, min: 0, max: 5000 },
    top: { kind: 'number', default: 24, min: 0, max: 5000 },
    bottom: { kind: 'number', default: 24, min: 0, max: 5000 }
  },
  'metadata-edit': {
    action: { kind: 'string', default: 'edit', values: ['edit', 'clear'] },
    title: { kind: 'string', default: '', maxLength: 512 },
    author: { kind: 'string', default: '', maxLength: 512 },
    subject: { kind: 'string', default: '', maxLength: 512 },
    creator: { kind: 'string', default: '', maxLength: 512 },
    keywords: { kind: 'string', default: '', maxLength: 512 }
  },
  'remove-pages': { pages: { kind: 'string', default: '', maxLength: 180 } },
  'extract-pages': { pages: { kind: 'string', default: '', maxLength: 180 } },
  optimize: {
    quality: { kind: 'number', default: 78, min: 35, max: 100 },
    maxImageDimension: { kind: 'number', default: 2200, min: 900, max: 5000 }
  }
};

export function defaultOptions(operation: WorkflowOperation): WorkflowStep['options'] {
  const result: WorkflowStep['options'] = Object.create(null);
  for (const [name, rule] of Object.entries(rules[operation])) {
    if (rule.default !== undefined) result[name] = rule.default;
  }
  return result;
}
export function validateStep(candidate: unknown): WorkflowStep {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw Error('Invalid workflow step.');
  const item = candidate as Record<string, unknown>;
  if (typeof item.operation !== 'string' || !OP_IDS.has(item.operation)) throw Error('Unsupported workflow operation.');
  if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id)) throw Error('Invalid workflow step ID.');
  const operation = item.operation as WorkflowOperation;
  const rawOptions = item.options && typeof item.options === 'object' && !Array.isArray(item.options)
    ? item.options as Record<string, unknown> : {};
  const options = defaultOptions(operation);
  for (const [name, rule] of Object.entries(rules[operation])) {
    const value = Object.prototype.hasOwnProperty.call(rawOptions, name) ? rawOptions[name] : rule.default;
    if (value === undefined) continue;
    if (rule.kind === 'boolean') {
      if (typeof value !== 'boolean') throw Error('Invalid ' + name + ' option.');
      options[name] = value;
    } else if (rule.kind === 'string') {
      if (typeof value !== 'string' || value.length > (rule.maxLength ?? 100)) throw Error('Invalid ' + name + ' option.');
      if (rule.values && !rule.values.includes(value)) throw Error('Invalid ' + name + ' option.');
      options[name] = value;
    } else {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < (rule.min ?? -Infinity) || value > (rule.max ?? Infinity)) throw Error('Out-of-range ' + name + ' option.');
      options[name] = value;
    }
  }
  // Reject a rotation value the worker cannot legitimately use.
  if (operation === 'rotate' && ![90, 180, 270].includes(options.degrees as number)) throw Error('Rotation must be 90°, 180° or 270°.');
  if (operation === 'rotate' && options.target === 'selected' && !String(options.pages).trim()) throw Error('Selected pages are required.');
  if (['remove-pages', 'extract-pages'].includes(operation) && !String(options.pages).trim()) throw Error('Enter the page numbers to select.');
  const pageRange = String(options.pages ?? '').trim();
  if (pageRange && !pageRange.split(',').every(token => {
    const match = token.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    return match && Number(match[1]) >= 1 && Number(match[1]) <= 1000 && (!match[2] || (Number(match[2]) >= Number(match[1]) && Number(match[2]) <= 1000));
  })) throw Error('Invalid page selection. Use pages such as 1,3-5 (maximum 1000).');
  if (operation === 'page-numbers' && !Number.isInteger(options.start)) throw Error('Starting number must be an integer.');
  if (operation === 'watermark' && !String(options.text).trim()) throw Error('Enter watermark text.');
  if (operation === 'crop' && !['left','right','top','bottom'].some((key) => Number(options[key]) > 0)) throw Error('Enter a non-zero crop margin.');
  if (operation === 'optimize') options.quality=Math.max(50,Math.min(95,Number(options.quality)));
  return { id: item.id, operation, options };
}
export function validateRecipe(candidate: unknown): WorkflowRecipe {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw Error('Invalid workflow recipe.');
  const item = candidate as Record<string, unknown>;
  if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id)) throw Error('Invalid recipe identifier.');
  if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 60) throw Error('Give the workflow a name of up to 60 characters.');
  if (!Array.isArray(item.steps) || !item.steps.length || item.steps.length > MAX_STEPS) throw Error('A workflow must have between one and eight steps.');
  const steps = item.steps.map(validateStep);
  if (new Set(steps.map(step => step.id)).size !== steps.length) throw Error('Workflow step IDs must be unique.');
  return { id: item.id, name: item.name.trim(), steps };
}
export function readRecipes(storage: Pick<Storage, 'getItem'>): WorkflowRecipe[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const recipes: WorkflowRecipe[] = [];
    const ids = new Set<string>();
    for (const value of parsed.slice(0, MAX_RECIPES)) {
      try {
        const recipe = validateRecipe(value);
        if (!ids.has(recipe.id)) { recipes.push(recipe); ids.add(recipe.id); }
      } catch { /* Invalid/stale presets are ignored without affecting documents. */ }
    }
    return recipes;
  } catch { return []; }
}
export function storeRecipes(storage: Pick<Storage, 'setItem'>, recipes: readonly WorkflowRecipe[]): void {
  if (recipes.length > MAX_RECIPES) throw Error('Only 15 saved workflows are supported.');
  const validated = recipes.map(validateRecipe);
  if (new Set(validated.map(r => r.id)).size !== validated.length) throw Error('Duplicate workflow preset ID.');
  storage.setItem(STORAGE_KEY, JSON.stringify(validated));
}
function assertPdf(output: OutputFile): void {
  if (output.buffer.byteLength > MAX_FILE_BYTES) throw Error('Workflow output exceeds the 50 MB per-file limit. Use a smaller document.');
  if (output.type !== 'application/pdf') throw Error('Workflow step did not return a PDF.');
  const head = new TextDecoder('ascii').decode(new Uint8Array(output.buffer, 0, Math.min(5, output.buffer.byteLength)));
  if (head !== '%PDF-') throw Error('Workflow step produced an invalid PDF header.');
}
export async function executeWorkflow(
  initial: InputFile, steps: readonly WorkflowStep[],
  start: WorkflowStarter, cancelled: () => boolean,
  onProgress: (event: WorkflowProgress) => void,
  setActive: (handle: RunningOperation | null) => void
): Promise<OutputFile> {
  const recipe = validateRecipe({ id: 'execution', name: 'Execution', steps });
  let file = initial;
  for (const [index, step] of recipe.steps.entries()) {
    if (cancelled()) throw new DOMException('Workflow cancelled', 'AbortError');
    onProgress({ step: index + 1, totalSteps: steps.length, percent: (index / steps.length) * 100, message: 'Starting ' + step.operation });
    const workerOptions=step.operation==='optimize'?{...step.options,imageQuality:Number(step.options.quality)/100}:step.options;
    const job = start(step.operation, [file], workerOptions, (status) => {
      if (!cancelled()) onProgress({
        step: index + 1,
        totalSteps: steps.length,
        percent: Math.min(99, (index + Math.min(100, Math.max(0, status.percent)) / 100) / steps.length * 100),
        message: status.message
      });
    });
    setActive(job);
    let output: OutputFile;
    try {
      const result = await job.result;
      if (cancelled()) throw new DOMException('Workflow cancelled', 'AbortError');
      if (result.outputs.length !== 1 || !result.outputs[0]) throw Error('A workflow step must return exactly one PDF.');
      output = result.outputs[0];
      assertPdf(output);
    } finally {
      setActive(null);
    }
    file = { name: output.name, type: output.type, buffer: output.buffer };
    onProgress({ step: index + 1, totalSteps: steps.length, percent: (index + 1) / steps.length * 100, message: step.operation + ' finished' });
  }
  return { name: 'workflow-result.pdf', type: 'application/pdf', buffer: file.buffer };
}
