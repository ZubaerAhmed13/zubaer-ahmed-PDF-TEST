import { addExportReview } from './exportReview';
import { addFileSharing } from './fileShare';

export function addShareButton(link: HTMLAnchorElement, blob: Blob, onShared?: () => void, source?: File, rename?: (name: string) => string): void {
  addExportReview(link, blob, source, rename);
  addFileSharing(link, blob, onShared);
}

/** Called explicitly after a tool renders its output links. No DOM observers. */
export function addOutputSharing(host: HTMLElement, outputs: { name: string; type: string; buffer: ArrayBuffer }[], sources?: File[]): void {
  const remaining = outputs.map((output, index) => ({ output, source: sources?.[index] }));
  for (const link of host.querySelectorAll<HTMLAnchorElement>('a[download]')) {
    const index = remaining.findIndex(item => item.output.name === link.download);
    const item = index < 0 ? undefined : remaining.splice(index, 1)[0];
    if (item) addShareButton(link, new Blob([item.output.buffer], { type: item.output.type }), undefined, item.source, name => {
      const used = new Set(outputs.filter(output => output !== item.output).map(output => output.name.toLowerCase()));
      const dot = name.lastIndexOf('.'); const stem = dot > 0 ? name.slice(0, dot) : name; const extension = dot > 0 ? name.slice(dot) : '';
      let unique = name, suffix = 2;
      while (used.has(unique.toLowerCase())) unique = stem + '-' + suffix++ + extension;
      item.output.name = unique; return unique;
    });
  }
}
