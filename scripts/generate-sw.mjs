import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else files.push(absolute);
  }
  return files;
}

const allFiles = await walk(DIST);
const cacheable = allFiles
  .map((absolute) => relative(DIST, absolute).split(sep).join('/'))
  .filter((path) => path !== 'sw.js' && !path.endsWith('.map'))
  .sort();

const hash = createHash('sha256');
for (const path of cacheable) {
  hash.update(path);
  hash.update(await readFile(join(DIST, path)));
}
const version = hash.digest('hex').slice(0, 16);
const precache = ['./', ...cacheable.map((path) => `./${path}`)];

const source = `const CACHE_NAME = 'docflow-static-${version}';
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
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('docflow-static-') && key !== CACHE_NAME).map((key) => caches.delete(key)))),
    self.clients.claim()
  ]));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

async function matchStatic(request) {
  return caches.match(request, { ignoreVary: true });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        return (await matchStatic(request)) || (await matchStatic(new URL('./', self.registration.scope))) || (await matchStatic(new URL('./index.html', self.registration.scope))) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await matchStatic(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
`;

await writeFile(join(DIST, 'sw.js'), source, 'utf8');
console.log(`Generated dist/sw.js with ${precache.length} precached URLs (${version}).`);
