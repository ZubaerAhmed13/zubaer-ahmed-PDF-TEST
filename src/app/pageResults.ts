import { outputFilename } from './exportReview';

export interface PageOutputInput { blob: Blob; name: string; source?: File; identity?: object; link?: HTMLAnchorElement }
export interface PageOutput extends PageOutputInput { id: string }
export interface PageResult { id: string; toolId: string; outputs: PageOutput[] }

/** Only the current operation is retained. No bytes or filenames enter history/storage. */
export class PageResults {
  private value: PageResult | null = null;
  constructor(private readonly budget = 256 * 1048576) {}
  start(toolId: string): string {
    const id = crypto.randomUUID();
    this.value = { id, toolId, outputs: [] };
    return id;
  }
  invalidate(): void { this.value = null; }
  private prune(): void { if (this.value) this.value.outputs = this.value.outputs.filter(output => !output.link || output.link.isConnected); }
  get(id: string): PageResult | null { this.prune(); return this.value?.id === id && this.value.outputs.length ? this.value : null; }
  add(token: string, input: PageOutputInput): PageOutput | null {
    if (!this.value || this.value.id !== token) return null;
    this.prune();
    const previous = input.identity && this.value.outputs.find(output => output.identity === input.identity);
    if (previous) return previous;
    if (input.blob.size + this.value.outputs.reduce((sum, output) => sum + output.blob.size, 0) > this.budget) throw Error('This output exceeds the result budget. Download it directly in the editor.');
    const output: PageOutput = { ...input, id: crypto.randomUUID(), name: input.name };
    this.value.outputs.push(output);
    this.rename(output.id, input.name);
    return output;
  }
  rename(id: string, value: string): void {
    const output = this.value?.outputs.find(item => item.id === id);
    if (!output) return;
    const clean = outputFilename(value, output.name);
    const dot = clean.lastIndexOf('.'), stem = dot > 0 ? clean.slice(0, dot) : clean, ext = dot > 0 ? clean.slice(dot) : '';
    const used = new Set(this.value!.outputs.filter(item => item !== output).map(item => item.name.toLowerCase()));
    let unique = clean, suffix = 2;
    while (used.has(unique.toLowerCase())) unique = stem + '-' + suffix++ + ext;
    output.name = unique;
    if (output.link?.isConnected && output.link.download !== unique) {
      output.link.dispatchEvent(new CustomEvent('docflow-output-name-request', { detail: unique }));
      output.name = output.link.download;
    }
  }
}
