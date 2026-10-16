import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { DocumentSession, pdfFilename, validateSessionPdf } from '../src/app/documentSession';
import { connectWorkspace, workspaceRuntime } from '../src/app/workspaceRuntime';
import { organizePdf, addPageNumbers, splitPdf } from '../src/pdf/core';
import { annotatePdf } from '../src/pdf/essentialEdits';
import type { InputFile, OperationResult } from '../src/pdf/types';

async function fixture(name = 'same.pdf'): Promise<File> {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]).drawText('FIRST SOURCE PAGE');
  pdf.addPage([400, 300]).drawText('SECOND SOURCE PAGE');
  return new File([new Uint8Array(await pdf.save())], name, { type: 'application/pdf' });
}
const input = async (file: File): Promise<InputFile> => ({ name: file.name, type: file.type, buffer: await file.arrayBuffer() });
const output = async (file: File): Promise<OperationResult['outputs']> => [{ name: file.name, type: file.type, buffer: await file.arrayBuffer() }];
async function stage(session: DocumentSession, file: File, tool = 'rotate'): Promise<void> {
  session.stage(session.snapshot().current!.id, tool, tool, [session.sourceId(file)], await output(file));
}

describe('in-memory document revisions', () => {
  it('chains real organize, annotation and numbering results and restores exact bytes on undo/redo', async () => {
    const original = await fixture();
    const session = new DocumentSession(); session.start(original);
    const operations = [
      (file: InputFile) => organizePdf([file], { order: '2,1' }, () => {}),
      (file: InputFile) => annotatePdf([file], { kind: 'note', text: 'SESSION NOTE', x: 10, y: 10, width: 60, height: 20, fontSize: 12 }, () => {}),
      (file: InputFile) => addPageNumbers([file], { start: 7, format: 'page', margin: 20 }, () => {})
    ];
    for (const [index, operation] of operations.entries()) {
      const current = session.snapshot().current!;
      const result = await operation(await input(current.file));
      session.stage(current.id, 'operation-' + index, 'Step ' + index, current.sourceIds, result.outputs);
      await session.apply(0, validateSessionPdf);
    }
    const final = session.snapshot().current!;
    const reader = await getDocument({ data: new Uint8Array(await final.file.arrayBuffer()) }).promise;
    try {
      const content = (await (await reader.getPage(1)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ');
      expect(content).toContain('SECOND SOURCE PAGE'); expect(content).toContain('SESSION NOTE'); expect(content).toContain('Page 7');
    } finally { await reader.destroy(); }
    expect((await PDFDocument.load(await final.file.arrayBuffer())).getPage(0).getWidth()).toBe(400);
    expect(session.snapshot().original!.file).toBe(original);
    const bytes = Buffer.from(await final.file.arrayBuffer());
    session.undo(); expect(session.snapshot().current!.id).not.toBe(final.id);
    session.redo(); expect(Buffer.from(await session.snapshot().current!.file.arrayBuffer())).toEqual(bytes);
  });

  it('distinguishes same-named sources by identity and preserves selection until a revision changes', async () => {
    const a = await fixture(); const b = await fixture();
    const session = new DocumentSession(); session.start(a);
    expect(session.sourceId(a)).not.toBe(session.sourceId(b));
    expect(session.sourceId(a)).toBe(session.sourceId(a));
    session.select([2, 1, 2, -1]); expect(session.snapshot().selection).toEqual([1, 2]);
    await stage(session, b); await session.apply(0, validateSessionPdf);
    expect(session.snapshot().selection).toEqual([]);
    expect(session.snapshot().current!.sourceIds).toEqual([session.sourceId(b)]);
  });

  it('bounds history, preserves the starting file and drops the redo branch after a new edit', async () => {
    const a = await fixture(); const session = new DocumentSession(); session.start(a);
    for (let i = 0; i < 11; i++) { await stage(session, a); await session.apply(0, validateSessionPdf); }
    expect(session.snapshot().history).toHaveLength(8); expect(session.snapshot().historyLimited).toBe(true);
    expect(session.snapshot().original!.file).toBe(a);
    session.undo(); const abandoned = session.snapshot().history.at(-1)!.id;
    await stage(session, a); await session.apply(0, validateSessionPdf);
    expect(session.snapshot().canRedo).toBe(false);
    expect(session.snapshot().history.map(item => item.id)).not.toContain(abandoned);
  });

  it('clears pre-redaction files and both history directions when a redacted result is applied', async () => {
    const original = await fixture('sensitive-original.pdf'); const redacted = await fixture('redacted.pdf');
    const session = new DocumentSession(); session.start(original);
    await stage(session, redacted, 'redact-secure'); await session.apply(0, validateSessionPdf);
    const state = session.snapshot();
    expect(state.history).toHaveLength(1); expect(state.original!.file.name).toBe('redacted.pdf');
    expect(state.original!.file).not.toBe(original); expect(state.canUndo || state.canRedo).toBe(false);
    session.undo(); expect(session.snapshot().current!.file.name).toBe('redacted.pdf');
  });

  it('retains the current revision when a result is invalid or encrypted/export-only', async () => {
    const original = await fixture(); const session = new DocumentSession(); session.start(original);
    const id = session.snapshot().current!.id;
    session.stage(id, 'repair-pdf', 'Broken', [], [{ name: 'invalid.pdf', type: 'application/pdf', buffer: new TextEncoder().encode('not a PDF').buffer }]);
    await expect(session.apply(0, validateSessionPdf)).rejects.toThrow(); expect(session.snapshot().current!.id).toBe(id);
    session.discardResult(); await stage(session, original, 'protect-pdf');
    await expect(session.apply(0, validateSessionPdf)).rejects.toThrow('download-only');
    expect(session.snapshot().current!.file).toBe(original);
  });

  it('rejects stale results and a late validation after the session is cleared', async () => {
    const a = await fixture(); const session = new DocumentSession(); session.start(a);
    const oldId = session.snapshot().current!.id;
    await stage(session, a);
    let resolve!: (pages: number) => void;
    const applying = session.apply(0, () => new Promise<number>(done => { resolve = done; }));
    session.start(await fixture('new.pdf')); resolve(2);
    await expect(applying).rejects.toThrow('changed');
    expect(() => session.stage(oldId, 'rotate', 'Late', [], [])).toThrow('earlier');
    expect(session.snapshot().current!.file.name).toBe('new.pdf');
  });

  it('selects a real split PDF explicitly and releases pending/history references on clear', async () => {
    const a = await fixture('a.pdf'); const session = new DocumentSession(); session.start(a);
    const result = await splitPdf([await input(a)], { mode: 'individual', individualPdfResults: true }, () => {});
    expect(result.outputs.map(item => item.type)).toEqual(['application/pdf', 'application/pdf']);
    session.stage(session.snapshot().current!.id, 'split', 'Split PDF', [session.sourceId(a)], result.outputs);
    await session.apply(1, validateSessionPdf);
    expect(session.snapshot().current!.file.name).toBe('split-02.pdf');
    const pdf = await PDFDocument.load(await session.snapshot().current!.file.arrayBuffer());
    expect(pdf.getPageCount()).toBe(1); expect(pdf.getPage(0).getWidth()).toBe(400);
    session.clear(); expect(session.snapshot().retainedBytes).toBe(0); expect(session.snapshot().pending).toBeNull();
  });

  it('sanitises export paths and control characters without exposing a filename as HTML', () => {
    expect(pdfFilename('../new\u0000/name.PDF')).toBe('..-new--name.pdf');
    expect(pdfFilename('')).toBe('document.pdf');
  });

  it('invalidates callbacks from disposed workspaces before mounting the next one', () => {
    const root = {} as HTMLElement; const calls: string[] = [];
    const disconnect = connectWorkspace(root, { sessionActive: () => true, inputs: () => {}, busy: () => calls.push('old'), result: () => calls.push('old'), selection: () => calls.push('old') });
    const oldRuntime = workspaceRuntime(root); disconnect();
    connectWorkspace(root, { sessionActive: () => true, inputs: () => {}, busy: () => calls.push('new'), result: () => calls.push('new'), selection: () => calls.push('new') });
    oldRuntime.busy(false); oldRuntime.result({ outputs: [] });
    workspaceRuntime(root).busy(true); expect(calls).toEqual(['new']);
  });
});
