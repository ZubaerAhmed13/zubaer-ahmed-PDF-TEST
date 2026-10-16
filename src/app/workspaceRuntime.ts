import type { OperationResult } from '../pdf/types';

export interface WorkspaceRuntime {
  busy(value: boolean): void;
  result(value: OperationResult): void;
  selection(pages: readonly number[]): void;
}

const runtimes = new WeakMap<HTMLElement, WorkspaceRuntime>();
const noop: WorkspaceRuntime = { busy() {}, result() {}, selection() {} };

/** Capture once at mount, so late completions cannot publish into a new tool. */
export function workspaceRuntime(root: HTMLElement): WorkspaceRuntime { return runtimes.get(root) ?? noop; }

export function connectWorkspace(root: HTMLElement, callbacks: WorkspaceRuntime): () => void {
  let active = true;
  const runtime: WorkspaceRuntime = {
    busy(value) { if (active) callbacks.busy(value); },
    result(value) { if (active) callbacks.result(value); },
    selection(pages) { if (active) callbacks.selection(pages); }
  };
  runtimes.set(root, runtime);
  return () => { active = false; if (runtimes.get(root) === runtime) runtimes.delete(root); };
}
