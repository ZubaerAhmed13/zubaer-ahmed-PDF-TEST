import type { OperationResult } from '../pdf/types';

export interface WorkspaceRuntime {
  sessionActive(): boolean;
  busy(value: boolean): void;
  inputs(files: readonly File[]): void;
  result(value: OperationResult): void;
  changed?(): void;
  selection(pages: readonly number[]): void;
}

const runtimes = new WeakMap<HTMLElement, WorkspaceRuntime>();
const noop: WorkspaceRuntime = { sessionActive() { return false; }, busy() {}, inputs() {}, result() {}, selection() {} };

/** Capture once at mount, so late completions cannot publish into a new tool. */
export function workspaceRuntime(root: HTMLElement): WorkspaceRuntime { return runtimes.get(root) ?? noop; }

export function connectWorkspace(root: HTMLElement, callbacks: WorkspaceRuntime): () => void {
  let active = true;
  const runtime: WorkspaceRuntime = {
    sessionActive() { return active && callbacks.sessionActive(); },
    busy(value) { if (active) callbacks.busy(value); },
    inputs(files) { if (active) callbacks.inputs(files); },
    result(value) { if (active) callbacks.result(value); },
    changed() { if (active) callbacks.changed?.(); },
    selection(pages) { if (active) callbacks.selection(pages); }
  };
  runtimes.set(root, runtime);
  return () => { active = false; if (runtimes.get(root) === runtime) runtimes.delete(root); };
}
