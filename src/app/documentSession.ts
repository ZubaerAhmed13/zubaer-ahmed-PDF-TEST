import type { OutputFile } from '../pdf/types';

export interface DocumentRevision {
  readonly id: string;
  readonly file: File;
  readonly label: string;
  readonly sourceIds: readonly string[];
  readonly pages: number | null;
}

export interface PendingRevision {
  readonly baseId: string;
  readonly toolId: string;
  readonly label: string;
  readonly sourceIds: readonly string[];
  readonly files: readonly File[];
  readonly exportOnly: boolean;
  readonly barrier: boolean;
}

export interface SessionSnapshot {
  readonly original: DocumentRevision | null;
  readonly current: DocumentRevision | null;
  readonly history: readonly DocumentRevision[];
  readonly index: number;
  readonly pending: PendingRevision | null;
  readonly selection: readonly number[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly retainedBytes: number;
  readonly historyLimited: boolean;
  readonly exported: boolean;
}

const MAX_HISTORY = 8;
const MEMORY_BUDGET = 128 * 1024 * 1024;

export function pdfFilename(name: string): string {
  const safe = [...name].map(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === '/' || character === '\\' ? '-' : character).join('');
  return (safe.replace(/\.pdf$/i, '').trim().slice(0, 110) || 'document') + '.pdf';
}

/** Immutable File snapshots, retained only in this tab. No storage/network API. */
export class DocumentSession {
  private original: DocumentRevision | null = null;
  private history: DocumentRevision[] = [];
  private index = -1;
  private pending: PendingRevision | null = null;
  private selection: number[] = [];
  private generation = 0;
  private exportedIds = new Set<string>();
  private ids = new WeakMap<File, string>();
  private listeners = new Set<() => void>();
  private limited = false;

  sourceId(file: File): string {
    let id = this.ids.get(file);
    if (!id) { id = crypto.randomUUID(); this.ids.set(file, id); }
    return id;
  }

  aliasSource(file: File, known: File): void { this.ids.set(file, this.sourceId(known)); }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void { this.listeners.forEach(listener => listener()); }

  snapshot(): SessionSnapshot {
    const current = this.history[this.index] ?? null;
    const files = new Set([this.original?.file, ...this.history.map(item => item.file), ...(this.pending?.files ?? [])]);
    return {
      original: this.original, current, history: [...this.history], index: this.index,
      pending: this.pending, selection: [...this.selection],
      canUndo: this.index > 0 && !this.pending, canRedo: this.index < this.history.length - 1 && !this.pending,
      retainedBytes: [...files].reduce((total, file) => total + (file?.size ?? 0), 0),
      historyLimited: this.limited, exported: Boolean(current && this.exportedIds.has(current.id))
    };
  }

  start(file: File): void {
    this.clear(false);
    const revision: DocumentRevision = Object.freeze({ id: crypto.randomUUID(), file, label: 'Original', sourceIds: [this.sourceId(file)], pages: null });
    this.original = revision;
    this.history = [revision];
    this.index = 0;
    this.emit();
  }

  stage(baseId: string, toolId: string, label: string, sourceIds: readonly string[], outputs: readonly OutputFile[]): void {
    if (this.snapshot().current?.id !== baseId) throw Error('This result belongs to an earlier revision. Run the tool again on the current document.');
    const pdfs = outputs.filter(output => output.type === 'application/pdf');
    if (!pdfs.length) return;
    if (pdfs.reduce((size, output) => size + output.buffer.byteLength, 0) > MEMORY_BUDGET) {
      throw Error('This result exceeds the 128 MB session limit. Download it from the tool and open it as a new document.');
    }
    this.pending = Object.freeze({ baseId, toolId, label, sourceIds: [...sourceIds],
      files: pdfs.map(output => new File([output.buffer], pdfFilename(output.name), { type: 'application/pdf' })),
      exportOnly: toolId === 'protect-pdf', barrier: toolId === 'redact-secure' });
    this.emit();
  }

  async apply(outputIndex: number, validate: (file: File) => Promise<number>): Promise<void> {
    const pending = this.pending;
    const file = pending?.files[outputIndex];
    if (!pending || !file || pending.exportOnly) throw Error('Choose an editable PDF result first. Encrypted results are download-only.');
    const generation = this.generation;
    const pages = await validate(file);
    if (!Number.isInteger(pages) || pages < 1) throw Error('The result has no valid PDF pages.');
    if (generation !== this.generation || this.pending !== pending || this.snapshot().current?.id !== pending.baseId) {
      throw Error('The document changed while the result was being checked.');
    }
    const revision: DocumentRevision = Object.freeze({ id: crypto.randomUUID(), file, label: pending.label,
      sourceIds: pending.barrier ? [crypto.randomUUID()] : [...pending.sourceIds], pages });
    this.pending = null;
    this.selection = [];
    if (pending.barrier) {
      // Applied secure redaction must never be undone into an unredacted export.
      this.original = Object.freeze({ ...revision, label: 'Starting point after redaction' });
      this.history = [revision];
      this.index = 0;
      this.exportedIds.clear();
      this.ids = new WeakMap();
      this.ids.set(file, revision.sourceIds[0]!);
      this.limited = false;
    } else {
      this.history = this.history.slice(0, this.index + 1);
      this.history.push(revision);
      const retained = new Set(this.history.map(item => item.id));
      this.exportedIds.forEach(id => { if (!retained.has(id)) this.exportedIds.delete(id); });
      this.index = this.history.length - 1;
      while (this.history.length > MAX_HISTORY || (this.snapshot().retainedBytes > MEMORY_BUDGET && this.history.length > 1)) {
        const removed = this.history.shift();
        if (removed) this.exportedIds.delete(removed.id);
        this.index--;
        this.limited = true;
      }
    }
    this.emit();
  }

  discardResult(): void { this.pending = null; this.generation++; this.emit(); }

  undo(): void {
    if (!this.snapshot().canUndo) return;
    this.index--; this.selection = []; this.generation++; this.emit();
  }

  redo(): void {
    if (!this.snapshot().canRedo) return;
    this.index++; this.selection = []; this.generation++; this.emit();
  }

  select(pages: readonly number[]): void {
    const count = this.snapshot().current?.pages;
    this.selection = [...new Set(pages)].filter(page => Number.isInteger(page) && page > 0 && (!count || page <= count)).sort((a, b) => a - b);
    this.emit();
  }

  markExported(): void {
    const current = this.snapshot().current;
    if (current) this.exportedIds.add(current.id);
    // Export bookkeeping must not replace the clicked anchor or revoke its URL.
    // Some browsers accept the Blob download after the click task has finished.
  }

  clear(emit = true): void {
    this.generation++;
    this.original = null; this.history = []; this.index = -1;
    this.pending = null; this.selection = []; this.limited = false;
    this.exportedIds.clear(); this.ids = new WeakMap();
    if (emit) this.emit();
  }
}

export async function validateSessionPdf(file: File): Promise<number> {
  const { PDFDocument } = await import('pdf-lib');
  const document = await PDFDocument.load(await file.arrayBuffer(), { throwOnInvalidObject: true });
  const count = document.getPageCount();
  if (!count) throw Error('The PDF contains no pages.');
  for (const page of document.getPages()) {
    const { width, height } = page.getSize();
    if (!(width > 0 && height > 0 && Number.isFinite(width + height))) throw Error('A page has invalid dimensions.');
  }
  return count;
}
