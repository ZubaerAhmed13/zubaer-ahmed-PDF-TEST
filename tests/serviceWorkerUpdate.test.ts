import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { MessageChannel } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';

async function updateCheck(states: ('safe' | 'work' | 'unresponsive')[]): Promise<{ skipped: boolean; messages: string[] }> {
  const generator = readFileSync('scripts/generate-sw.mjs', 'utf8');
  const template = generator.slice(generator.indexOf('const source = `') + 16, generator.lastIndexOf('`;'));
  const source = template.replace('${version}', 'test').replace('${JSON.stringify(precache)}', '[]');
  const listeners = new Map<string, (event: unknown) => void>();
  let skipped = false; const messages: string[] = [];
  const clients = states.map((state, index) => ({ url: 'https://example.test/docflow/' + index,
    postMessage(_data: unknown, ports: MessagePort[]) {
      if (state !== 'unresponsive') { ports[0]!.postMessage({ safe: state === 'safe' }); ports[0]!.close(); }
    }
  }));
  const self = { registration: { scope: 'https://example.test/docflow/' },
    addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, callback),
    clients: { matchAll: async () => clients }, skipWaiting: async () => { skipped = true; }
  };
  runInNewContext(source, { self, URL, MessageChannel, setTimeout, clearTimeout });
  let completion: Promise<void> | undefined;
  listeners.get('message')!({ data: { type: 'SKIP_WAITING' }, source: { postMessage: (data: { type: string }) => messages.push(data.type) }, waitUntil: (promise: Promise<void>) => { completion = promise; } });
  await completion;
  return { skipped, messages };
}

describe('actual generated service-worker update protocol', () => {
  it('uses the current application shell offline while retaining older hashed assets', async () => {
    const generator = readFileSync('scripts/generate-sw.mjs', 'utf8');
    const template = generator.slice(generator.indexOf('const source = `') + 16, generator.lastIndexOf('`;'));
    const source = template.replace('${version}', 'test').replace('${JSON.stringify(precache)}', '[]');
    const listeners = new Map<string, (event: unknown) => void>();
    let oldCacheReads = 0;
    runInNewContext(source, {
      self: { registration: { scope: 'https://example.test/docflow/' }, location: { origin: 'https://example.test' }, addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, callback) },
      URL, MessageChannel, setTimeout, clearTimeout,
      fetch: async () => { throw Error('offline'); },
      caches: { open: async () => ({ match: async () => 'current-app-shell' }), match: async () => { oldCacheReads++; return 'previous-app-shell'; } }
    });
    let response: Promise<string> | undefined;
    listeners.get('fetch')!({ request: { method: 'GET', mode: 'navigate', url: 'https://example.test/docflow/' }, respondWith: (promise: Promise<string>) => { response = promise; } });
    expect(await response).toBe('current-app-shell'); expect(oldCacheReads).toBe(0);
  });

  it('activates only when every open DocFlow tab confirms safety', async () => {
    expect(await updateCheck(['safe', 'safe'])).toEqual({ skipped: true, messages: ['DOCFLOW_UPDATE_ACCEPTED'] });
  });
  it('keeps the waiting worker when another tab retains work', async () => {
    expect(await updateCheck(['safe', 'work'])).toEqual({ skipped: false, messages: ['DOCFLOW_UPDATE_BLOCKED'] });
  });
  it('fails closed when an old or suspended tab cannot answer', async () => {
    expect(await updateCheck(['safe', 'unresponsive'])).toEqual({ skipped: false, messages: ['DOCFLOW_UPDATE_BLOCKED'] });
  });
});
