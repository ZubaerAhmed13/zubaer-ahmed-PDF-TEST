import { describe, expect, it } from 'vitest';
import { WorkspaceHistory } from '../src/v2/workspaceHistory';

const revision = (name: string, size = 1) => ({ name, size });

describe('workspace history', () => {
  it('moves exact workspaces in both directions and discards a replaced branch', () => {
    const history = new WorkspaceHistory<ReturnType<typeof revision>>();
    const split = revision('split'), rotate = revision('rotate');
    history.remember(split);
    expect(history.move('previous', rotate)).toBe(split);
    expect(history.peek('next')).toBe(rotate);
    expect(history.move('next', split)).toBe(rotate);
    expect(history.move('previous', rotate)).toBe(split);
    history.remember(split);
    expect(history.peek('next')).toBeUndefined();
    expect(history.peek('previous')).toBe(split);
  });

  it('evicts the oldest workspaces when their combined file payload exceeds 128 MiB', () => {
    const history = new WorkspaceHistory<ReturnType<typeof revision>>();
    const size = 50 * 1024 * 1024;
    history.remember(revision('oldest', size));
    const middle = revision('middle', size), latest = revision('latest', size);
    history.remember(middle);
    history.remember(latest);
    expect(history.limited).toBe(true);
    expect(history.move('previous', revision('active'))).toBe(latest);
    expect(history.move('previous', latest)).toBe(middle);
    expect(history.peek('previous')).toBeUndefined();
  });

  it('bounds the count and does not skip an oversized immediate revision', () => {
    const history = new WorkspaceHistory<ReturnType<typeof revision>>();
    for (let index = 0; index < 9; index++) history.remember(revision(String(index)));
    for (let index = 8; index >= 1; index--) {
      expect(history.move('previous', revision('active'))?.name).toBe(String(index));
    }
    expect(history.peek('previous')).toBeUndefined();
    history.remember(revision('small'));
    history.remember(revision('large', 129 * 1024 * 1024));
    expect(history.peek('previous')).toBeUndefined();
    expect(history.peek('next')).toBeUndefined();
    expect(history.limited).toBe(true);
    history.clear();
    expect(history.limited).toBe(false);
  });
});
