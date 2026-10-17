/** Fit dialogs to the visible viewport, including the on-screen keyboard. Keep browser pinch zoom native. */
export function installMobileViewport(): void {
  const viewport = window.visualViewport;
  const update = (): void => {
    // Do not resize the editor during browser magnification: native zoom/pan owns that gesture.
    if (viewport && Math.abs(viewport.scale - 1) > 0.05) return;
    const height = viewport?.height ?? window.innerHeight;
    document.documentElement.style.setProperty('--df-visible-height', `${height}px`);
    document.documentElement.style.setProperty('--df-visible-top', `${viewport?.offsetTop ?? 0}px`);
    document.documentElement.classList.toggle('keyboard-open', window.innerHeight - height > 140);
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused.matches('input,textarea,select') && focused.closest('dialog[open]')) {
      requestAnimationFrame(() => {
        const rect = focused.getBoundingClientRect();
        if (rect.bottom > height + (viewport?.offsetTop ?? 0) - 60 || rect.top < (viewport?.offsetTop ?? 0)) {
          focused.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
      });
    }
  };
  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  document.addEventListener('focusin', update);
  update();
}
