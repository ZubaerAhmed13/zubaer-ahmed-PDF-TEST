export type OfflineGroup = 'core' | 'eng' | 'deu';
export interface OfflineAsset { path: string; bytes: number; sha256: string }
export interface OfflineManifest {
  version: string; coreCache: string; ocrCache: string;
  groups: Record<OfflineGroup, OfflineAsset[]>;
}
const base = (): string => new URL(import.meta.env.BASE_URL, location.origin).href;
const digest = async (bytes: ArrayBuffer): Promise<string> => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
const assetUrl = (asset: OfflineAsset): string => new URL(asset.path, base()).href;
export const assetBytes = (assets: OfflineAsset[]): number => assets.reduce((sum, asset) => sum + asset.bytes, 0);
export const sizeLabel = (bytes: number): string => `${(bytes / 1048576).toFixed(1)} MB`;

export async function offlineManifest(): Promise<OfflineManifest> {
  const response = await fetch(new URL('offline-manifest.json', base()));
  if (!response.ok) throw Error('Offline setup is unavailable. Connect and reopen Offline & storage.');
  return response.json() as Promise<OfflineManifest>;
}
export function cacheFor(manifest: OfflineManifest, group: OfflineGroup): string {
  return group === 'core' ? manifest.coreCache : manifest.ocrCache;
}
export async function missingAssets(manifest: OfflineManifest, group: OfflineGroup): Promise<OfflineAsset[]> {
  if (!('caches' in globalThis)) throw Error('This browser does not allow offline storage. Online PDF tools still work.');
  const cache = await caches.open(cacheFor(manifest, group));
  const missing: OfflineAsset[] = [];
  for (const asset of manifest.groups[group]) {
    const response = await cache.match(assetUrl(asset), { ignoreVary: true });
    // Verify real stored bytes: eviction, truncation and same-size corruption must show as missing.
    if (!response?.ok) { missing.push(asset); continue; }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== asset.bytes || (asset.sha256 && await digest(bytes) !== asset.sha256)) missing.push(asset);
  }
  if (group === 'core') {
    // Both shell URLs and the setup manifest are required for an offline reload.
    for (const path of ['./', './offline-manifest.json']) {
      if (!(await cache.match(new URL(path, base()).href))?.ok) {
        if (!missing.some(a => a.path === path)) missing.push({ path, bytes: 0, sha256: '' });
      }
    }
  }
  return missing;
}
export async function prepareOffline(
  manifest: OfflineManifest, group: OfflineGroup, signal: AbortSignal,
  progress: (done: number, total: number) => void
): Promise<void> {
  const assets = await missingAssets(manifest, group);
  const cache = await caches.open(cacheFor(manifest, group));
  const total = assetBytes(assets);
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  if (estimate?.quota && total > estimate.quota - (estimate.usage ?? 0)) {
    throw Error('There is not enough browser storage for this download. Free space and try again.');
  }
  let done = 0;
  for (const asset of assets) {
    signal.throwIfAborted();
    const response = await fetch(assetUrl(asset), { signal, cache: 'reload', headers: { 'X-DocFlow-Prepare': '1' } });
    if (!response.ok) throw Error('An offline asset could not be downloaded. Reconnect and retry.');
    const bytes = await response.clone().arrayBuffer();
    signal.throwIfAborted();
    if (asset.bytes && bytes.byteLength !== asset.bytes) throw Error('An offline download is incomplete. Reconnect and retry.');
    if (asset.sha256) {
      if (await digest(bytes) !== asset.sha256) throw Error('An offline download did not match this release. Reload after exporting your work.');
    }
    signal.throwIfAborted();
    await cache.put(assetUrl(asset), response);
    done += bytes.byteLength;
    progress(done, total);
  }
}
export async function assertOfflineOcr(language: 'eng' | 'deu'): Promise<void> {
  if (navigator.onLine) return;
  const manifest = await offlineManifest();
  if (!navigator.serviceWorker?.controller || (await missingAssets(manifest, language)).length) {
    throw Error(`Offline OCR assets are missing for ${language === 'eng' ? 'English' : 'German'}. Connect, open Offline & storage and prepare that language before trying again.`);
  }
}

export function mountOfflinePanel(host: HTMLElement): () => void {
  const events = new AbortController();
  let download: AbortController | null = null;
  let disposed = false;
  let manifest: OfflineManifest | undefined;
  host.innerHTML = `<section class="offline-panel" aria-labelledby="offline-title"><h2 id="offline-title">Offline & storage</h2><p>Prepare this browser before travelling. These downloads contain application files and OCR models, never your documents. Browser storage can be cleared or evicted.</p><p data-network role="status"></p><div data-offline-groups></div><p data-offline-progress role="status" aria-live="polite">Checking stored assets…</p><button type="button" class="secondary" data-offline-cancel hidden>Cancel download</button><p data-offline-storage></p><div class="offline-actions"><button type="button" class="secondary" data-offline-refresh>Check again</button><button type="button" class="secondary" data-offline-persist>Request persistent storage</button></div><details><summary>Using DocFlow on your phone</summary><p>Use your browser’s Add to Home Screen or Install action if available. Choose a file from Files or your device picker. Use Pan page to scroll and pinch-zoom; use Select objects to place marks. Object properties provide precise placement without dragging.</p><p>Download saves a copy. Save / share opens your system’s file sharing options where supported; you choose the destination. Keep this tab open and export before switching apps for a long time: the operating system may discard background tabs. Offline files are not cloud backups.</p></details></section>`;
  const q = <T extends HTMLElement = HTMLElement>(selector: string): T => host.querySelector<T>(selector)!;
  const status = q('[data-offline-progress]');
  const network = (): void => { q('[data-network]').textContent = navigator.onLine ? 'Your browser reports a connection. Stored assets are checked separately below.' : 'You are offline. Prepared local tools remain available.'; };
  const labels = { core: 'Core PDF tools', eng: 'English OCR', deu: 'German OCR' };
  const refresh = async (): Promise<void> => {
    network();
    try {
      manifest = await offlineManifest();
      const rows = await Promise.all((['core', 'eng', 'deu'] as const).map(async group => ({ group, missing: await missingAssets(manifest!, group) })));
      if (disposed) return;
      const controlled = Boolean(navigator.serviceWorker?.controller);
      q('[data-offline-groups]').replaceChildren();
      for (const { group, missing } of rows) {
        const row = document.createElement('section'); row.className = 'offline-group'; row.dataset.offlineGroup = group;
        const heading = document.createElement('h3'); heading.textContent = labels[group];
        const state = document.createElement('p'); state.dataset.offlineState = group;
        state.textContent = !missing.length && controlled ? 'Ready in this browser' : !missing.length ? 'Assets stored · reload once to enable offline use' : `${missing.length} asset(s) missing · ${sizeLabel(assetBytes(missing))} to store`;
        const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary';
        button.textContent = `Prepare ${labels[group]}`; button.dataset.prepare = group; button.disabled = !missing.length || Boolean(download);
        row.append(heading, state, button); q('[data-offline-groups]').append(row);
      }
      const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
      const persistent = await navigator.storage?.persisted?.().catch(() => false);
      if (disposed) return;
      q('[data-offline-storage]').textContent = `${estimate ? `${sizeLabel(estimate.usage ?? 0)} used / ${sizeLabel(estimate.quota ?? 0)} browser quota. ` : 'Storage estimate unavailable. '}Persistence ${persistent ? 'granted' : 'not granted'}. Recheck after clearing browser data or long periods of inactivity.`;
      if (!download) status.textContent = 'Checked the stored files. This does not certify your device; test a sample PDF in airplane mode before relying on it.';
    } catch (error) { if (!disposed) status.textContent = error instanceof Error ? error.message : 'Offline storage is unavailable. Online tools remain available.'; }
  };
  host.addEventListener('click', event => {
    const target = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!target) return;
    if (target.matches('[data-offline-cancel]')) { download?.abort(); return; }
    if (target.matches('[data-offline-refresh]') && !download) void refresh();
    if (target.matches('[data-offline-persist]')) {
      void (async () => { const granted = await navigator.storage?.persist?.().catch(() => false); if (!disposed) status.textContent = granted ? 'Persistent storage granted. You can still clear it in browser settings.' : 'Persistence was not granted by this browser. You can still prepare assets, but storage may be evicted.'; })();
    }
    const group = target.dataset.prepare as OfflineGroup | undefined;
    if (!group || !manifest || download) return;
    const controller = download = new AbortController();
    host.querySelectorAll<HTMLButtonElement>('[data-prepare],[data-offline-refresh]').forEach(b => { b.disabled = true; });
    q('[data-offline-cancel]').hidden = false;
    status.textContent = 'Downloading application assets…';
    void prepareOffline(manifest, group, controller.signal, (done, total) => { if (!disposed) status.textContent = `Stored ${sizeLabel(done)} of ${sizeLabel(total)}. Keep this panel open.`; })
      .then(() => 'Download complete. Stored assets verified.')
      .catch((error: unknown) => controller.signal.aborted ? 'Download cancelled. Completed assets are retained; retry downloads only missing files.' : error instanceof Error ? error.message : 'Download failed. Check storage and connection, then retry.')
      .then(async message => {
        download = null;
        if (disposed) return;
        q('[data-offline-cancel]').hidden = true;
        await refresh();
        if (!disposed) { status.textContent = message; status.tabIndex = -1; status.focus({ preventScroll: true }); }
      });
  }, { signal: events.signal });
  window.addEventListener('online', () => { if (!download) void refresh(); else network(); }, { signal: events.signal });
  window.addEventListener('offline', network, { signal: events.signal });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !download) void refresh(); }, { signal: events.signal });
  void refresh();
  return () => { disposed = true; download?.abort(); events.abort(); };
}
