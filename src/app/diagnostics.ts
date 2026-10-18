interface DiagnosticOptions { release: boolean; environment: boolean }
const capabilities = ['online', 'workers', 'serviceWorker', 'controlled', 'cacheStorage', 'indexedDB'] as const;

/** Reconstruct from a strict allowlist. Never serialize browser/document objects or arbitrary logs. */
export function diagnosticReport(input: Record<string, unknown>, options: DiagnosticOptions): Record<string, unknown> {
  const report: Record<string, unknown> = { format: 'docflow-diagnostics', schema: 1 };
  if (options.release) report.release = {
    version: typeof input.version === 'string' && /^\d+\.\d+\.\d+$/.test(input.version) ? input.version : 'unknown',
    build: typeof input.build === 'string' && /^(?:[a-f0-9]{7,40}|local)$/.test(input.build) ? input.build : 'unknown'
  };
  if (options.environment) report.environment = Object.fromEntries(capabilities.map(key => [key, typeof input[key] === 'boolean' ? input[key] : null]));
  return report;
}

export function mountDiagnostics(host: HTMLElement): () => void {
  host.innerHTML = `<section class="product-panel"><h2>Diagnostics</h2><p>Version <strong>${__DOCFLOW_VERSION__}</strong> · Build <code>${__DOCFLOW_BUILD__}</code></p><p>Create a local report to help investigate a problem. It contains only release identity and browser feature booleans. Documents, names, settings, accounts, URLs and logs are excluded. Nothing is sent automatically.</p><fieldset><legend>Include in report</legend><label class="product-check"><input type="checkbox" name="diagnostic-release" checked> Version and build</label><label class="product-check"><input type="checkbox" name="diagnostic-environment" checked> Connection and browser features</label></fieldset><label class="product-label">Report preview<textarea data-diagnostic-preview readonly rows="14" spellcheck="false"></textarea></label><label class="product-check"><input type="checkbox" data-diagnostic-reviewed> I reviewed this report and want to download it</label><button type="button" class="primary" data-diagnostic-download disabled>Download diagnostics</button><p role="status" data-diagnostic-status>Review the report before downloading. You decide whether to share the saved file.</p></section>`;
  const preview = host.querySelector<HTMLTextAreaElement>('[data-diagnostic-preview]')!;
  const reviewed = host.querySelector<HTMLInputElement>('[data-diagnostic-reviewed]')!;
  const download = host.querySelector<HTMLButtonElement>('[data-diagnostic-download]')!;
  const status = host.querySelector<HTMLElement>('[data-diagnostic-status]')!;
  let objectUrl: string | undefined;
  const releaseUrl = (): void => { if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = undefined; };
  const refresh = (): void => {
    releaseUrl(); reviewed.checked = false; download.disabled = true;
    preview.value = JSON.stringify(diagnosticReport({ version: __DOCFLOW_VERSION__, build: __DOCFLOW_BUILD__,
      online: navigator.onLine, workers: typeof Worker !== 'undefined', serviceWorker: 'serviceWorker' in navigator,
      controlled: Boolean(navigator.serviceWorker?.controller), cacheStorage: 'caches' in window, indexedDB: 'indexedDB' in window
    }, { release: host.querySelector<HTMLInputElement>('[name=diagnostic-release]')!.checked,
      environment: host.querySelector<HTMLInputElement>('[name=diagnostic-environment]')!.checked }), null, 2);
    status.textContent = 'Review the report before downloading. You decide whether to share the saved file.';
  };
  host.querySelectorAll('[name^=diagnostic-]').forEach(input => input.addEventListener('change', refresh));
  reviewed.addEventListener('change', () => { download.disabled = !reviewed.checked; });
  download.addEventListener('click', () => {
    if (!reviewed.checked) return;
    releaseUrl(); objectUrl = URL.createObjectURL(new Blob([preview.value], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = objectUrl; link.download = 'docflow-diagnostics.json';
    link.click(); status.textContent = 'Download requested. No report was uploaded.';
  });
  refresh();
  return releaseUrl;
}
