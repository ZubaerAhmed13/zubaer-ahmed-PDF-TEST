import { allowWorkerUpdate, approveReload, prepareApprovedReload } from './app/workProtection';

function showUpdate(registration: ServiceWorkerRegistration): void {
  if (document.querySelector('[data-app-update]')) return;
  const banner = document.createElement('section');
  banner.className = 'update-banner';
  banner.dataset.appUpdate = 'true';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  banner.innerHTML = '<div><strong>A new version of DocFlow is available.</strong><span>Your current work will not reload until you choose Update.</span></div><div class="update-actions"><button type="button" class="secondary" data-dismiss-update>Later</button><button type="button" class="primary" data-apply-update>Update</button></div>';

  banner.querySelector<HTMLButtonElement>('[data-dismiss-update]')?.addEventListener('click', () => banner.remove());
  banner.querySelector<HTMLButtonElement>('[data-apply-update]')?.addEventListener('click', async () => {
    if (!await approveReload('Update and clear session')) return;
    const waiting = registration.waiting;
    if (!waiting) return;
    const button = banner.querySelector<HTMLButtonElement>('[data-apply-update]')!;
    button.disabled = true;
    const checking = document.createElement('dialog');
    checking.className = 'session-confirm';
    checking.setAttribute('aria-label', 'Checking open DocFlow tabs');
    checking.innerHTML = '<h2>Checking open tabs</h2><p>Confirming that this update can safely proceed…</p>';
    checking.addEventListener('cancel', event => event.preventDefault());
    document.body.append(checking); checking.showModal();
    allowWorkerUpdate(true);
    const onMessage = (event: MessageEvent): void => {
      if (event.data?.type !== 'DOCFLOW_UPDATE_BLOCKED') return;
      allowWorkerUpdate(false);
      button.disabled = false; checking.remove();
      window.clearTimeout(checkTimer);
      banner.querySelector('span')!.textContent = 'Another DocFlow tab still has work, or could not confirm it is safe. Finish or close that tab, then choose Update again.';
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      navigator.serviceWorker.removeEventListener('message', onMessage);
    };
    let reloaded = false;
    const onControllerChange = (): void => {
      if (reloaded) return;
      reloaded = true;
      navigator.serviceWorker.removeEventListener('message', onMessage);
      window.clearTimeout(checkTimer);
      checking.remove();
      prepareApprovedReload();
      window.location.reload();
    };
    const checkTimer = window.setTimeout(() => {
      allowWorkerUpdate(false); button.disabled = false; checking.remove();
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      navigator.serviceWorker.removeEventListener('message', onMessage);
      banner.querySelector('span')!.textContent = 'The update could not confirm that all tabs are safe. Finish or close other DocFlow tabs and try again.';
    }, 8000);
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange, { once: true });
    navigator.serviceWorker.addEventListener('message', onMessage);
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
