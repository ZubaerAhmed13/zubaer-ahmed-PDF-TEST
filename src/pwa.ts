export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
      // Offline remains an explicit capability check; registration failure is non-fatal.
    });
  }, { once: true });
}
