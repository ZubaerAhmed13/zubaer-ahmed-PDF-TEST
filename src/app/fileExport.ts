import { addExportReview } from './exportReview';
/** Prepare bytes before the user gesture: share() must run synchronously on click. */
export function addShareButton(link: HTMLAnchorElement, blob: Blob, onShared?: () => void, source?: File, rename?: (name: string) => string): void {
  addExportReview(link, blob, source, rename);
  if (!navigator.share || !navigator.canShare) return;
  const file = new File([blob], link.download || 'docflow-result.pdf', { type: blob.type });
  try { if (!navigator.canShare({ files: [file] })) return; } catch { return; }
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'secondary file-share'; button.textContent = 'Save / share';
  button.setAttribute('aria-label', `Save / share ${link.download || 'result'}`);
  link.addEventListener?.('docflow-output-renamed', () => button.setAttribute('aria-label', `Save / share ${link.download || 'result'}`));
  const status = document.createElement('span'); status.className = 'file-share-status'; status.setAttribute('role', 'status');
  button.addEventListener('click', () => {
    // Creating a File is synchronous and reflects any edited export filename.
    const current = new File([blob], link.download || file.name, { type: blob.type });
    button.disabled = true; status.textContent = '';
    try {
      const sharing = navigator.share({ files: [current] });
      void sharing.then(() => { status.textContent = 'Sent to the selected share destination.'; onShared?.(); })
        .catch((error: unknown) => { status.textContent = error instanceof Error && error.name === 'AbortError' ? 'Sharing cancelled. Your download is still available.' : 'Sharing is unavailable. Use the download link to save a copy.'; })
        .finally(() => { button.disabled = false; });
    } catch { button.disabled = false; status.textContent = 'Sharing is unavailable. Use the download link to save a copy.'; }
  });
  link.after(button, status);
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
