export type RevisionDirection = 'previous' | 'next';

const MAX_RETAINED_WORKSPACES = 8;
const PAYLOAD_BUDGET = 128 * 1024 * 1024;

/** Inactive workspaces stay in this tab. The active workspace has its own limits. */
export class WorkspaceHistory<T extends { size: number }> {
  private readonly stacks: Record<RevisionDirection, T[]> = { previous: [], next: [] };
  limited = false;

  peek(direction: RevisionDirection): T | undefined {
    return this.stacks[direction].at(-1);
  }

  remember(workspace: T): void {
    this.stacks.next.length = 0;
    this.retain('previous', workspace);
  }

  move(direction: RevisionDirection, current: T): T | undefined {
    const target = this.stacks[direction].pop();
    if (target) this.retain(direction === 'previous' ? 'next' : 'previous', current);
    return target;
  }

  clear(): void {
    this.stacks.previous.length = 0;
    this.stacks.next.length = 0;
    this.limited = false;
  }

  private retain(direction: RevisionDirection, workspace: T): void {
    const { previous, next } = this.stacks;
    const stack = this.stacks[direction];
    if (workspace.size > PAYLOAD_BUDGET) {
      // A gap would make the next revision jump across a missing workspace.
      stack.length = 0;
      this.limited = true;
      return;
    }
    stack.push(workspace);
    const retained = [...previous, ...next];
    let size = retained.reduce((sum, entry) => sum + entry.size, 0);
    while (previous.length + next.length > MAX_RETAINED_WORKSPACES || size > PAYLOAD_BUDGET) {
      const farthest = previous.length >= next.length ? previous : next;
      size -= farthest.shift()!.size;
      this.limited = true;
    }
  }
}
