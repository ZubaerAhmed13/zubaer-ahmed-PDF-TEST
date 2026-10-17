/** Prepare bytes before the user gesture: share() must run synchronously on click. */
export function addShareButton(link: HTMLAnchorElement, blob: Blob, onShared?: () => void): void {
  if (!navigator.share || !navigator.canShare) return;
  const file = new File([blob], link.download || 'docflow-result.pdf', { type: blob.type });
  try { if (!navigator.canShare({ files: [file] })) return; } catch { return; }
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'secondary file-share'; button.textContent = 'Save / share';
  button.setAttribute('aria-label', `Save / share ${link.download || 'result'}`);
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
export function addOutputSharing(host: HTMLElement, outputs: { name: string; type: string; buffer: ArrayBuffer }[]): void {
  const remaining = [...outputs];
  for (const link of host.querySelectorAll<HTMLAnchorElement>('a[download]')) {
    const index = remaining.findIndex(output => output.name === link.download);
    const output = index < 0 ? undefined : remaining.splice(index, 1)[0];
    if (output) addShareButton(link, new Blob([output.buffer], { type: output.type }));
  }
}
