import { describe, it, expect } from 'vitest';
import { checkAvailability } from '../scripts/check-availability.mjs';

describe('read-only availability probe', () => {
  const identity = { format: 'docflow-release', schema: 1, version: '0.9.0', build: 'a'.repeat(40) };
  const fixture = (changed = false) => async (url: URL) => {
    const path = url.pathname;
    if (path.endsWith('release.json')) return new Response(JSON.stringify(changed ? { ...identity, build: 'b'.repeat(40) } : identity));
    if (path.endsWith('manifest.webmanifest')) return new Response(JSON.stringify({ start_url: './', scope: './' }));
    if (path.endsWith('.js')) return new Response('console.log("app")', { headers: { 'Content-Type': 'application/javascript' } });
    return new Response('<div id="app"></div><script type="module" src="/app/assets/main.js"></script>');
  };
  it('checks identity, shell, local entry asset and PWA manifest', async () => {
    await expect(checkAvailability('https://example.test/app/', identity.build, '0.9.0', fixture())).resolves.toMatchObject({ version: '0.9.0', build: identity.build, checks: 4 });
  });
  it('fails on stale release identity and unavailable assets', async () => {
    await expect(checkAvailability('https://example.test/app/', identity.build, '0.9.0', fixture(true))).rejects.toThrow(/identity/i);
    await expect(checkAvailability('https://example.test/app/', identity.build, '0.9.0', async () => new Response('no', { status: 503 }))).rejects.toThrow(/503/);
  });
});
