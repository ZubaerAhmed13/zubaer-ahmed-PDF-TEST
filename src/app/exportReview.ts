import { preservationConsequences } from '../pdf/preservationPolicy';
import '../styles/export-review.css';
import { workspaceRuntime } from './workspaceRuntime';

export interface OutputAction { action: 'review' | 'continue' | 'compare'; file: File; source?: File; status: HTMLElement }
export function outputFilename(value: string, original: string): string {
  const extension = original.match(/\.[a-z0-9]{1,8}$/i)?.[0] ?? '';
  const clean = [...value].map(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || /[<>:"/\\|?*]/.test(character) ? '-' : character).join('').trim().replace(/^\.+|[. ]+$/g, '');
  const base = extension && clean.toLowerCase().endsWith(extension.toLowerCase()) ? clean.slice(0, -extension.length) : clean;
  return (base.slice(0, 100) || 'document') + extension;
}

/** Explicitly mounted next to each output. The existing tool still owns its URL. */
export function addExportReview(link: HTMLAnchorElement, blob: Blob, source?: File, rename?: (name: string) => string): void {
  const root = link.closest?.<HTMLElement>('#workspace');
  if (!root || link.dataset.exportReviewed) return;
  link.dataset.exportReviewed = 'true';
  const originalName = link.download;
  const tool = root.dataset.toolId ?? '';
  const capturedSource = source ?? workspaceRuntime(root).sources?.().find(file => file.type === 'application/pdf' || /\.pdf$/i.test(file.name));
  const details = document.createElement('details'); details.className = 'export-review';
  const heading = document.createElement('summary'); heading.textContent = 'Review export · ' + blob.size.toLocaleString() + ' bytes';
  const format = document.createElement('p'); format.textContent = (blob.type || 'File') + ' · exact size ' + blob.size.toLocaleString() + ' bytes · saved only when you download or share';
  const label = document.createElement('label'); label.textContent = 'Output filename';
  const name = document.createElement('input'); name.type = 'text'; name.value = link.download; name.maxLength = 110; name.autocomplete = 'off';
  label.append(name);
  name.addEventListener('input', () => {
    const filename = outputFilename(name.value, originalName);
    link.download = rename?.(filename) ?? filename;
    link.textContent = 'Download ' + link.download;
    link.dispatchEvent(new Event('docflow-output-renamed', { bubbles: true }));
  });
  name.addEventListener('change', () => { name.value = link.download; });
  const summary = document.createElement('p');
  summary.textContent = blob.type === 'application/pdf' ? preservationConsequences(tool).join(' ') : 'This output uses the selected format. Download it to open it in a compatible application. A report or archive does not replace your source PDF.';
  details.append(heading, format, label, summary);
  if (blob.type === 'application/pdf' && tool !== 'protect-pdf') {
    const actions = document.createElement('div'); actions.className = 'export-next';
    const status = document.createElement('p'); status.setAttribute('role', 'status');
    for (const [action, title] of [['review', 'Preview / reopen result'], ['compare', 'Compare with original'], ['continue', 'Continue with this result']] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = title;
      button.addEventListener('click', () => {
        status.textContent = '';
        link.dispatchEvent(new CustomEvent<OutputAction>('docflow-result-action', { bubbles: true, detail: { action, file: new File([blob], link.download, { type: blob.type }), source: capturedSource, status } }));
      });
      actions.append(button);
    }
    details.append(actions, status);
  } else if (tool === 'protect-pdf') {
    summary.textContent = 'Encrypted PDF: download and open it with its password. Unlock a copy before continuing to edit. Encryption does not remove original active content or attachments.';
  }
  link.after(details);
}
