import { describe, expect, it } from 'vitest';
import { findTools } from '../src/app/toolDiscovery';
import { diagnosticReport } from '../src/app/diagnostics';
import { tools } from '../src/tools/registry';

describe('task discovery', () => {
  it('matches everyday intentions and independent query words', () => {
    expect(findTools('make pdf smaller').map(t => t.id)).toContain('compress');
    expect(findTools('jpg to pdf').map(t => t.id)).toContain('images-to-pdf');
    expect(findTools('pages rotate').map(t => t.id)).toContain('rotate');
    expect(findTools('searchable scan').map(t => t.id)).toContain('ocr');
    expect(findTools('black out confidential').map(t => t.id)).toContain('redact-secure');
  });
  it('respects categories and never invents unsupported conversion tools', () => {
    expect(findTools('word to pdf')).toEqual([]);
    expect(findTools('merge', 'security')).toEqual([]);
    expect(findTools('')).toEqual(tools);
    for (const tool of tools) expect(findTools(tool.name).map(t => t.id)).toContain(tool.id);
  });
});

describe('reviewable diagnostic allowlist', () => {
  const input = { version: '0.9.0', build: '9a6d772', online: true, workers: true, serviceWorker: true,
    controlled: false, cacheStorage: true, indexedDB: false, filename: 'SECRET.pdf', password: 'secret',
    token: 'secret', url: 'https://example.test/#token', logs: ['private text'], userAgent: 'private browser' };
  it('serializes only release identity and capability booleans', () => {
    const report = diagnosticReport(input, { release: true, environment: true });
    expect(report).toEqual({ format: 'docflow-diagnostics', schema: 1, release: { version: '0.9.0', build: '9a6d772' },
      environment: { online: true, workers: true, serviceWorker: true, controlled: false, cacheStorage: true, indexedDB: false } });
    expect(JSON.stringify(report)).not.toMatch(/secret|private|example|filename|password|token|logs|userAgent/i);
  });
  it('redacts unchecked groups and rejects malformed release values', () => {
    expect(diagnosticReport(input, { release: false, environment: false })).toEqual({ format: 'docflow-diagnostics', schema: 1 });
    expect(diagnosticReport({ version: 'user@example.test', build: 'password', online: 'secret' }, { release: true, environment: true }))
      .toMatchObject({ release: { version: 'unknown', build: 'unknown' }, environment: { online: null } });
  });
});
