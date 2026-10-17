import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { assetBytes, missingAssets, prepareOffline, removeOfflineLanguage, type OfflineManifest } from '../src/app/offline';

const bytes = new TextEncoder().encode('verified local engine');
const hash = createHash('sha256').update(bytes).digest('hex');
const asset = { path: './ocr/worker.min.js', bytes: bytes.length, sha256: hash };
const manifest: OfflineManifest = { version: 'test', coreCache: 'core', ocrCache: 'ocr', groups: { core: [], eng: [asset], deu: [asset] } };
let stored: Map<string, Response>;
beforeEach(() => {
  stored = new Map();
  vi.stubGlobal('location', { origin: 'https://example.test' });
  vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: 0, quota: 1e9 }) } });
  vi.stubGlobal('caches', { open: async () => ({
    match: async (url: string) => stored.get(url)?.clone(),
    delete: async (url: string) => stored.delete(url),
    put: async (url: string, response: Response) => { stored.set(url, response.clone()); }
  }) });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes, { headers: { 'content-type': 'text/javascript' } })));
});
afterEach(() => vi.unstubAllGlobals());

describe('offline files, cancellation and storage failures', () => {
  it('verifies downloads then detects truncated and evicted cache entries', async () => {
    expect(await missingAssets(manifest, 'eng')).toHaveLength(1);
    const progress = vi.fn();
    await prepareOffline(manifest, 'eng', new AbortController().signal, progress);
    expect(await missingAssets(manifest, 'eng')).toEqual([]);
    expect(progress).toHaveBeenCalledWith(bytes.length, bytes.length);
    expect(assetBytes(manifest.groups.eng)).toBe(bytes.length);
    const [url] = stored.keys();
    stored.set(url!, new Response(new Uint8Array(bytes.length)));
    expect(await missingAssets(manifest, 'eng')).toEqual([asset]);
    stored.set(url!, new Response('truncated'));
    expect(await missingAssets(manifest, 'eng')).toEqual([asset]);
    stored.clear();
    expect(await missingAssets(manifest, 'eng')).toEqual([asset]);
  });
  it('does not publish wrong-version or incomplete download bodies', async () => {
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array(bytes.length)));
    await expect(prepareOffline(manifest, 'eng', new AbortController().signal, () => {})).rejects.toThrow('did not match this release');
    expect(stored.size).toBe(0);
    vi.stubGlobal('fetch', async () => new Response('short'));
    await expect(prepareOffline(manifest, 'eng', new AbortController().signal, () => {})).rejects.toThrow('incomplete');
    expect(stored.size).toBe(0);
  });
  it('cancellation before storage leaves the group missing and can be retried', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', async () => { controller.abort(); return new Response(bytes); });
    await expect(prepareOffline(manifest, 'eng', controller.signal, () => {})).rejects.toMatchObject({ name: 'AbortError' });
    expect(stored.size).toBe(0);
    vi.stubGlobal('fetch', async () => new Response(bytes));
    await prepareOffline(manifest, 'eng', new AbortController().signal, () => {});
    expect(await missingAssets(manifest, 'eng')).toEqual([]);
  });
  it('fails before downloading when the browser reports insufficient quota', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: 99, quota: 100 }) } });
    await expect(prepareOffline(manifest, 'eng', new AbortController().signal, () => {})).rejects.toThrow('not enough');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not report readiness after a CacheStorage quota failure', async () => {
    vi.stubGlobal('caches', { open: async () => ({ match: async () => undefined, put: async () => { throw new DOMException('Storage full', 'QuotaExceededError'); } }) });
    await expect(prepareOffline(manifest, 'eng', new AbortController().signal, () => {})).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect(await missingAssets(manifest, 'eng')).toEqual([asset]);
  });
  it('removes one language while retaining shared engine and the other model', async () => {
    const english = { ...asset, path: './ocr/lang/eng.traineddata' }, german = { ...asset, path: './ocr/lang/deu.traineddata' };
    const m = { ...manifest, groups: { core: [], eng: [asset, english], deu: [asset, german] } };
    await prepareOffline(m, 'eng', new AbortController().signal, () => {});
    await prepareOffline(m, 'deu', new AbortController().signal, () => {});
    await removeOfflineLanguage(m, 'eng');
    expect(await missingAssets(m, 'eng')).toEqual([english]);
    expect(await missingAssets(m, 'deu')).toEqual([]);
  });
  it('requires the reload shell and setup manifest as well as engine assets', async () => {
    expect((await missingAssets(manifest, 'core')).map(a => a.path)).toEqual(['./', './offline-manifest.json']);
  });
});
