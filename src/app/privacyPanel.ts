import { clearProjectSnapshot } from './projectStore';

export function mountPrivacyPanel(host: HTMLElement, options: { workspaceOpen: boolean; clearPreferences: () => void }): void {
  host.innerHTML = `<section class="product-panel"><h2>Privacy & data controls</h2><p>PDF and image processing stays in this browser. No analytics, document telemetry or automatic crash reporting is configured. Documents and session revisions live only in this tab’s memory. Export before closing or reloading.</p><dl><dt>On this browser</dt><dd>Favourites and recent-tool IDs; saved workflow recipes; recovery file metadata and permitted settings. PDF bytes and encryption passwords are excluded from recovery storage. Recipe files may contain text you deliberately enter.</dd><dt>Offline assets</dt><dd>Application files and OCR language models, managed in Offline & storage. They are not document backups.</dd><dt>Optional cloud sync</dt><dd>Only favourite/recent tool IDs, linked to your optional account. Local removal does not change saved cloud data. Use Cloud sync to save an empty preference list or sign out. No automatic account deletion is offered.</dd></dl><h3>Clear local information</h3><p>These actions affect this browser. Another open tab or a later Save can write preferences or recovery metadata again.</p><button type="button" class="secondary" data-clear-preferences>Clear local favourites and recent tools</button><p>Saved recipes have their own Delete control in Workflow builder. Keep a recipe file if you want a backup.</p><button type="button" class="secondary" data-clear-recovery ${options.workspaceOpen ? 'disabled' : ''}>Clear saved recovery metadata</button>${options.workspaceOpen ? '<p>Close the workspace before clearing recovery metadata, so its active save cannot recreate it.</p>' : ''}<p role="status" data-privacy-status></p><button type="button" class="secondary" data-action="cloud">Cloud sync</button><button type="button" class="secondary" data-action="offline">Offline & storage</button><button type="button" class="secondary" data-action="help">Account and support help</button></section>`;
  const status = host.querySelector<HTMLElement>('[data-privacy-status]')!;
  host.querySelector('[data-clear-preferences]')!.addEventListener('click', () => {
    try { options.clearPreferences(); status.textContent = 'Local favourites and recent tools cleared. Saved cloud preferences and recipes are unchanged.'; }
    catch { status.textContent = 'Storage access was denied. Local persistence could not be cleared; in-memory preferences may have changed.'; }
  });
  const recovery = host.querySelector<HTMLButtonElement>('[data-clear-recovery]')!;
  recovery.addEventListener('click', () => {
    if (options.workspaceOpen) return;
    recovery.disabled = true;
    void clearProjectSnapshot().then(() => { status.textContent = 'Saved recovery metadata cleared. Original files and downloads are unchanged.'; })
      .catch(() => { status.textContent = 'Recovery storage is unavailable or busy. Close other tabs and try again.'; })
      .finally(() => { recovery.disabled = false; });
  });
}
