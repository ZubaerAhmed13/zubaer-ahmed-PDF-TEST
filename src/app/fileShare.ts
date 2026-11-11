/** Prepare the result before the click so share starts with user activation. */
export function addFileSharing(link: HTMLAnchorElement, blob: Blob, onShared?: () => void): void {
  if (!navigator.share || !navigator.canShare) return;
  const file = new File([blob], link.download || 'docflow-result.pdf', { type: blob.type });
  try { if (!navigator.canShare({ files: [file] })) return; } catch { return; }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary file-share';
  button.textContent = 'Save / share';
  const updateLabel = () => button.setAttribute('aria-label', `Save / share ${link.download || 'result'}`);
  updateLabel();
  link.addEventListener?.('docflow-output-renamed', updateLabel);

  const status = document.createElement('span');
  status.className = 'file-share-status';
  status.setAttribute('role', 'status');
  const fallback = 'Sharing is unavailable. Use the download link to save a copy.';
  button.addEventListener('click', () => {
    const current = new File([blob], link.download || file.name, { type: blob.type });
    button.disabled = true;
    status.textContent = '';
    try {
      const sharing = navigator.share({ files: [current] });
      void sharing.then(() => {
        status.textContent = 'Sent to the selected share destination.';
        onShared?.();
      }).catch((error: unknown) => {
        status.textContent = error instanceof Error && error.name === 'AbortError'
          ? 'Sharing cancelled. Your download is still available.' : fallback;
      }).finally(() => { button.disabled = false; });
    } catch {
      button.disabled = false;
      status.textContent = fallback;
    }
  });
  link.after(button, status);
}
