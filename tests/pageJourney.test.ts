import { describe, expect, it } from 'vitest';
import { parsePageRoute, pageRouteHash } from '../src/app/pageRoutes';
import { PageResults } from '../src/app/pageResults';

describe('dedicated page routes', () => {
  const ids = new Set(['edit-pdf', 'merge']);
  it('round trips stable tool routes and opaque result routes', () => {
    expect(parsePageRoute('#/tools/edit-pdf', ids)).toEqual({ kind: 'tool', toolId: 'edit-pdf' });
    expect(pageRouteHash({ kind: 'tool', toolId: 'merge' })).toBe('#/tools/merge');
    expect(parsePageRoute('#/results/abc-123', ids)).toEqual({ kind: 'result', id: 'abc-123' });
    expect(parsePageRoute('#tools', ids)).toEqual({ kind: 'home' });
  });
  it('rejects malformed and unavailable tool/result paths', () => {
    for (const hash of ['#/tools/unknown', '#/tools/%ZZ', '#/results/', '#/results/name.pdf', '#/tools/merge/extra']) {
      expect(parsePageRoute(hash, ids).kind).toBe('missing');
    }
  });
});

describe('transient result ownership', () => {
  it('keeps same-name outputs distinct and renames without changing bytes', async () => {
    const store = new PageResults();
    const token = store.start('split');
    const first = store.add(token, { blob: new Blob(['FIRST']), name: 'same.pdf' });
    const second = store.add(token, { blob: new Blob(['SECOND']), name: 'same.pdf' });
    expect(first!.name).toBe('same.pdf');
    expect(second!.name).toBe('same-2.pdf');
    store.rename(first!.id, '../renamed.pdf');
    expect(first!.name).toBe('-renamed.pdf');
    expect(await second!.blob.text()).toBe('SECOND');
    expect(store.get(token)!.outputs).toHaveLength(2);
  });
  it('does not admit late outputs or expired result links after source changes', () => {
    const store = new PageResults();
    const old = store.start('edit-pdf');
    store.add(old, { blob: new Blob(['OLD']), name: 'a.pdf' });
    store.invalidate();
    expect(store.get(old)).toBeNull();
    expect(store.add(old, { blob: new Blob(['LATE']), name: 'a.pdf' })).toBeNull();
    const current = store.start('merge');
    expect(current).not.toBe(old);
    expect(store.get(current)).toBeNull();
  });
  it('deduplicates the same rendered output identity and enforces the result budget', () => {
    const store = new PageResults(8);
    const token = store.start('merge'), identity = {};
    const first = store.add(token, { blob: new Blob(['1234']), name: 'a.pdf', identity });
    expect(store.add(token, { blob: new Blob(['1234']), name: 'a.pdf', identity })).toBe(first);
    expect(() => store.add(token, { blob: new Blob(['56789']), name: 'b.pdf' })).toThrow(/result budget/i);
    expect(store.get(token)!.outputs).toHaveLength(1);
  });
});
