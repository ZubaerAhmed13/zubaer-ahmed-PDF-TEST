import { describe, it, expect } from 'vitest';
import {
  MAX_STEPS, DEFAULT_WORKFLOW_RECIPES, STORAGE_KEY, validateRecipe, validateStep,
  readRecipes, storeRecipes, executeWorkflow, type WorkflowRecipe, type WorkflowStarter,
  type WorkflowStep
} from '../src/workflows/workflowEngine';
import type { OperationProgress } from '../src/pdf/types';

const header = (): ArrayBuffer => Uint8Array.of(37,80,68,70,45,49,46,55).buffer;

describe('Phase 4 workflow orchestration', () => {
  it('supports a multi-step chain and passes each PDF output into the next step', async () => {
    const calls: Array<{ op: string; inputSize: number }> = [];
    const start: WorkflowStarter = (operation, files, _, progress) => {
      calls.push({ op: operation, inputSize: files[0]!.buffer.byteLength });
      progress({ stage: 'processing', completed: 1, total: 1, percent: 100, message: operation + ' processed' } satisfies OperationProgress);
      return { result: Promise.resolve({
        outputs: [{ name: operation + '.pdf', type: 'application/pdf', buffer: header() }]
      }), cancel: () => {} };
    };
    const steps: WorkflowStep[] = [
      { id: 'a', operation: 'rotate', options: { target: 'all', degrees: 90 } },
      { id: 'b', operation: 'page-numbers', options: { format: 'page-total' } },
      { id: 'c', operation: 'optimize', options: {} }
    ];
    const progress: number[] = [];
    const output = await executeWorkflow(
      { name: 'sample.pdf', type: 'application/pdf', buffer: header() },
      steps, start, () => false,
      event => { progress.push(event.percent); },
      () => {}
    );
    expect(calls.map(c => c.op)).toEqual(['rotate', 'page-numbers', 'optimize']);
    expect(calls.every(c => c.inputSize === 8)).toBe(true);
    expect(output.buffer.byteLength).toBe(8);
    expect(output.name).toBe('workflow-result.pdf');
    expect(progress.at(-1)).toBe(100);
  });

  it('rejects invalid recipes, unsupported operations and unbounded steps', () => {
    expect(() => validateRecipe({ id: 'x', name: '', steps: [] })).toThrow();
    expect(() => validateRecipe({ id: 'x', name: 'Many', steps: Array.from({ length: MAX_STEPS+1 }, (_, i) => ({
      id: 's' + i, operation: 'rotate', options: {}
    })) })).toThrow();
    expect(() => validateStep({ id: 'bad', operation: 'protect-pdf', options: { password: 'secret' } })).toThrow();
    expect(() => validateStep({ id: 'bad', operation: 'remove-pages', options: { pages: '' } })).toThrow();
    expect(() => validateStep({ id: 'bad', operation: 'rotate', options: { degrees: 17 } })).toThrow();
    expect(() => validateStep({ id: 'bad', operation: 'crop', options: { left: 0, right: 0, top: 0, bottom: 0 } })).toThrow();
  });

  it('whitelists persisted recipe options instead of accepting arbitrary fields', () => {
    const recipe = validateRecipe({
      id: 'preset', name: 'Safe',
      steps: [{ id: 'step1', operation: 'watermark', options: {
        text: 'DRAFT', opacity: .4, password: 'PRIVATE', fileContents: 'PDF-BYTES'
      } }]
    });
    expect(JSON.stringify(recipe)).not.toContain('PRIVATE');
    expect(JSON.stringify(recipe)).not.toContain('PDF-BYTES');
    expect(recipe.steps[0]!.options.text).toBe('DRAFT');
  });

  it('persists only opt-in recipe configuration and tolerates bad local storage', () => {
    let value: string | null = null;
    const storage = {
      getItem: (key: string) => key === STORAGE_KEY ? value : null,
      setItem: (key: string, next: string) => { if (key === STORAGE_KEY) value = next; }
    };
    expect(readRecipes(storage)).toEqual([]);
    const original: WorkflowRecipe = { ...DEFAULT_WORKFLOW_RECIPES[0]!, id: 'local-only' };
    storeRecipes(storage, [original]);
    const retrieved = readRecipes(storage);
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0]?.steps).toHaveLength(2);
    expect(value).not.toContain('.pdf');
    value = '{invalid';
    expect(readRecipes(storage)).toEqual([]);
    expect(() => storeRecipes(storage, Array.from({ length: 16 }, (_, i) => ({
      ...original, id: 'recipe' + i
    })))).toThrow();
  });

  it('stops the sequence after a failed step and never executes following steps', async () => {
    const executed: string[] = [];
    const start: WorkflowStarter = (op) => {
      executed.push(op);
      return { result: op === 'rotate'
        ? Promise.reject(new Error('Worker failed'))
        : Promise.resolve({ outputs: [{ name: 'good.pdf', type: 'application/pdf', buffer: header() }] }),
        cancel: () => {} };
    };
    await expect(executeWorkflow(
      { name: 'sample.pdf', type: 'application/pdf', buffer: header() },
      [
        { id: '1', operation: 'rotate', options: {} },
        { id: '2', operation: 'optimize', options: {} }
      ],
      start, () => false, () => {}, () => {}
    )).rejects.toThrow('Worker failed');
    expect(executed).toEqual(['rotate']);
  });

  it('cancels before the next operation even if a previous one completed', async () => {
    let isCancelled = false;
    const executed: string[] = [];
    const start: WorkflowStarter = (op) => {
      executed.push(op);
      isCancelled = true;
      return { result: Promise.resolve({ outputs: [{ name: 'good.pdf', type: 'application/pdf', buffer: header() }] }), cancel: () => {} };
    };
    await expect(executeWorkflow(
      { name: 'original.pdf', type: 'application/pdf', buffer: header() },
      [{ id: 'one', operation: 'rotate', options: {} }, { id: 'two', operation: 'optimize', options: {} }],
      start, () => isCancelled, () => {}, () => {}
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(executed).toEqual(['rotate']);
  });
});
