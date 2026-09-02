function showUpdate(registration: ServiceWorkerRegistration): void {
  if (document.querySelector('[data-app-update]')) return;
  const banner = document.createElement('section');
  banner.className = 'update-banner';
  banner.dataset.appUpdate = 'true';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  banner.innerHTML = '<div><strong>A new version of DocFlow is available.</strong><span>Your current work will not reload until you choose Update.</span></div><div class="update-actions"><button type="button" class="secondary" data-dismiss-update>Later</button><button type="button" class="primary" data-apply-update>Update</button></div>';

  banner.querySelector<HTMLButtonElement>('[data-dismiss-update]')?.addEventListener('click', () => banner.remove());
  banner.querySelector<HTMLButtonElement>('[data-apply-update]')?.addEventListener('click', () => {
    const waiting = registration.waiting;
    if (!waiting) return;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    }, { once: true });
    waiting.postMessage({ type: 'SKIP_WAITING' });
  });
  document.body.append(banner);
}

function watchForUpdates(registration: ServiceWorkerRegistration): void {
  if (registration.waiting && navigator.serviceWorker.controller) showUpdate(registration);
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate(registration);
    });
  });
}

export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js', { scope: './' }).then((registration) => {
      watchForUpdates(registration);
      void registration.update();
    }).catch(() => {
      // Registration failure is non-fatal; diagnostics expose service-worker state.
    });
  }, { once: true });
}
