import { mountCloudPanel, type CloudPanelOptions } from '../app/cloudSync';

export function openPreferencesDialog(trigger: HTMLButtonElement, options: CloudPanelOptions): void {
  if (document.querySelector('.df2-preferences-dialog')) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'df2-offline-dialog df2-preferences-dialog';
  dialog.setAttribute('aria-label', 'Cloud preferences');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'df2-offline-close';
  close.textContent = 'Close';
  const host = document.createElement('div');
  dialog.append(close, host);
  mountCloudPanel(host, options);
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (trigger.isConnected) trigger.focus({ preventScroll: true });
  }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
}
