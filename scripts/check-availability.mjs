import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';

/** A small, independent HTTP probe. Never reads browser accounts/documents/storage. */
export async function checkAvailability(base, expectedBuild, expectedVersion, fetcher = fetch) {
  const root = new URL(base);
  if (!['https:', 'http:'].includes(root.protocol) || root.username || root.password || root.search || root.hash || !root.pathname.endsWith('/')) throw Error('Use a public HTTP(S) application URL ending in /.');
  const get = async path => {
    const response = await fetcher(new URL(path, root), { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error(`Availability failed: HTTP ${response.status}`);
    return response;
  };
  const identity = await (await get('release.json')).json();
  if (identity.format !== 'docflow-release' || identity.schema !== 1 || identity.build !== expectedBuild || identity.version !== expectedVersion) throw Error('Release identity differs from the expected build/version.');
  const html = await (await get('./')).text();
  const entry = html.match(/<script\b[^>]*type="module"[^>]*src="([^"]+)"/i)?.[1];
  if (!html.includes('<div id="app"></div>') || !entry) throw Error('Application shell or module entry is missing.');
  const url = new URL(entry, root);
  if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname) || !url.pathname.endsWith('.js') || url.search || url.hash) throw Error('Unexpected application entry.');
  const js = await get(url.href);
  if (!/javascript/.test(js.headers.get('content-type') ?? '') || !(await js.text()).length) throw Error('Compiled application entry is unavailable.');
  const manifest = await (await get('manifest.webmanifest')).json();
  if (manifest.start_url !== './' || manifest.scope !== './') throw Error('PWA manifest has an unexpected application scope.');
  return { version: identity.version, build: identity.build, checks: 4 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  try {
    if (!process.argv[2] || !process.argv[3]) throw Error('Usage: node scripts/check-availability.mjs APP_URL EXPECTED_BUILD [EXPECTED_VERSION]');
    console.log(JSON.stringify(await checkAvailability(process.argv[2], process.argv[3], process.argv[4] || pkg.version)));
  } catch (error) { console.error(error instanceof Error ? error.message : 'Availability check failed.'); process.exitCode = 1; }
}
