import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else files.push(absolute);
  }
  return files;
}

const allFiles = await walk(DIST);
const cacheable = allFiles
  .map((absolute) => relative(DIST, absolute).split(sep).join('/'))
  .filter((path) => path !== 'sw.js' && path !== 'offline-manifest.json' && !path.endsWith('.map') && !path.startsWith('ocr/'))
  .sort();

const hash = createHash('sha256');
for (const path of cacheable) {
  hash.update(path);
  hash.update(await readFile(join(DIST, path)));
}
const version = hash.digest('hex').slice(0, 16);
const ocrPaths = allFiles.map(absolute => relative(DIST, absolute).split(sep).join('/'))
  .filter(path => path.startsWith('ocr/') && /(?:worker\.min\.js|lstm\.wasm(?:\.js)?|traineddata\.gz)$/.test(path)).sort();
async function asset(path) {
  const data = await readFile(join(DIST, path));
  return { path: './' + path, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
}
const coreAssets = await Promise.all(cacheable.map(asset));
const ocrAssets = await Promise.all(ocrPaths.map(asset));
const ocrVersion = createHash('sha256').update(JSON.stringify(ocrAssets)).digest('hex').slice(0, 16);
const ocrCache = 'docflow-ocr-' + ocrVersion;
const manifest = {
  version, coreCache: 'docflow-static-' + version, ocrCache,
  groups: {
    core: coreAssets,
    eng: ocrAssets.filter(a => !a.path.includes('/lang/') || a.path.endsWith('/eng.traineddata.gz')),
    deu: ocrAssets.filter(a => !a.path.includes('/lang/') || a.path.endsWith('/deu.traineddata.gz'))
  }
};
await writeFile(join(DIST, 'offline-manifest.json'), JSON.stringify(manifest));
const precache = ['./', ...cacheable.map((path) => `./${path}`), './offline-manifest.json'];

const source = `const CACHE_NAME = 'docflow-static-${version}';
const OCR_CACHE = '${ocrCache}';
const PRECACHE = ${JSON.stringify(precache)};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const requests = PRECACHE.map((path) => new Request(new URL(path, self.registration.scope), { cache: 'reload' }));
    await cache.addAll(requests);
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('docflow-static-')).slice(0, -2).filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
    self.clients.claim()
  ]));
});

async function clientIsSafe(client) {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 2000);
    channel.port1.onmessage = event => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(event.data?.safe === true);
    };
    try { client.postMessage({ type: 'DOCFLOW_QUERY_WORK' }, [channel.port2]); }
    catch { clearTimeout(timer); channel.port1.close(); resolve(false); }
  });
}

self.addEventListener('message', event => {
  if (event.data?.type !== 'SKIP_WAITING') return;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const scope = new URL(self.registration.scope);
    const appClients = clients.filter(client => {
      const url = new URL(client.url);
      return url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
    });
    const approvals = await Promise.all(appClients.map(clientIsSafe));
    if (approvals.every(Boolean)) {
      event.source?.postMessage({ type: 'DOCFLOW_UPDATE_ACCEPTED' });
      await self.skipWaiting();
    }
    else event.source?.postMessage({ type: 'DOCFLOW_UPDATE_BLOCKED' });
  })());
});

async function matchStatic(request) {
  try {
    const current = await caches.open(CACHE_NAME);
    return (await current.match(request, { ignoreVary: true })) || await caches.match(request, { ignoreVary: true });
  } catch { return undefined; }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Setup validates exact bytes before publishing to a cache. Do not pre-cache its unverified response.
  if (request.headers?.get('X-DocFlow-Prepare') === '1') {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      // Keep the running release shell until the guarded update activates.
      const installed = await matchStatic(new URL('./', self.registration.scope));
      if (installed) return installed;
      try {
        const response = await fetch(request);
        if (response.ok) {
          try {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, response.clone());
          } catch { /* Cache eviction/quota is non-fatal online. */ }
        }
        return response;
      } catch {
        return (await matchStatic(request)) || (await matchStatic(new URL('./', self.registration.scope))) || (await matchStatic(new URL('./index.html', self.registration.scope))) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const isOcr = url.pathname.startsWith(new URL('./ocr/', self.registration.scope).pathname);
    const cache = await caches.open(isOcr ? OCR_CACHE : CACHE_NAME).catch(() => null);
    const cached = isOcr ? await cache?.match(request).catch(() => undefined) : await matchStatic(request);
    if (cached && request.cache !== 'reload') return cached;
    const response = await fetch(request);
    if (response.ok) {
      // A quota error must never turn a successful fetch into a broken tool.
      try { await cache?.put(request, response.clone()); } catch { /* Readiness reports missing assets. */ }
    }
    return response;
  })());
});
`;

await writeFile(join(DIST, 'sw.js'), source, 'utf8');
console.log(`Generated dist/sw.js with ${precache.length} precached URLs (${version}).`);
