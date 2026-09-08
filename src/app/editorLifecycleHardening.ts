const RETRY_TOOL_KEY = 'docflow.retry-tool.v1';
const RETRY_TOOL_PARAM = 'docflowRetry';
const STACKED_EDITOR_QUERY = '(max-width: 820px)';
const NESTED_VERTICAL_SCROLL_OWNERS = [
  '.pre-edit-canvas-shell',
  '.pre-edit-thumbnail-rail',
  '.legacy-overview-canvas-shell',
  '.legacy-files-pane',
  '.legacy-settings-pane'
].join(',');

let installed = false;
let lastWorkspaceTrigger: HTMLElement | null = null;
let lastToolId: string | null = null;

function workspaceDialog(): HTMLDialogElement | null {
  return document.querySelector<HTMLDialogElement>('#workspace-dialog');
}

function rememberOpenTrigger(target: Element): void {
  const openTool = target.closest<HTMLElement>('[data-open-tool]');
  if (openTool?.dataset.openTool) {
    lastWorkspaceTrigger = openTool;
    lastToolId = openTool.dataset.openTool;
    return;
  }

  const openAction = target.closest<HTMLElement>('[data-action="open"]');
  if (openAction) {
    lastWorkspaceTrigger = openAction;
    lastToolId = 'preview';
  }
}

function focusOpeningControl(): void {
  if (lastWorkspaceTrigger?.isConnected) {
    lastWorkspaceTrigger.focus({ preventScroll: true });
    return;
  }
  if (!lastToolId) return;
  document.querySelector<HTMLElement>(`#tool-grid [data-open-tool="${CSS.escape(lastToolId)}"]`)?.focus({ preventScroll: true });
}

function retryUrl(toolId: string): string {
  const url = new URL(location.href);
  url.searchParams.set(RETRY_TOOL_PARAM, toolId);
  return url.href;
}

function clearRetryMarker(): void {
  try { sessionStorage.removeItem(RETRY_TOOL_KEY); } catch { /* storage unavailable */ }

  const url = new URL(location.href);
  if (!url.searchParams.has(RETRY_TOOL_PARAM)) return;
  url.searchParams.delete(RETRY_TOOL_PARAM);
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function pendingRetryToolId(): string | null {
  const fromUrl = new URL(location.href).searchParams.get(RETRY_TOOL_PARAM);
  if (fromUrl) return fromUrl;
  try {
    return sessionStorage.getItem(RETRY_TOOL_KEY);
  } catch {
    return null;
  }
}

function retryFailedModule(errorPanel: HTMLElement, event: Event): void {
  const toolId = errorPanel.dataset.loadErrorFor;
  if (!toolId) return;

  /* A rejected native dynamic import may remain rejected in the browser's
   * module map for the lifetime of the page. A same-document second import is
   * therefore not a reliable recovery path. Reload into a fresh document and
   * carry only the non-sensitive tool id. The URL marker is authoritative
   * because WebKit can lose a just-written sessionStorage value across this
   * fault-injected navigation; sessionStorage remains a compatibility fallback.
   * No PDF/image bytes are stored or replayed. */
  event.preventDefault();
  event.stopImmediatePropagation();
  try { sessionStorage.setItem(RETRY_TOOL_KEY, toolId); } catch { /* storage unavailable */ }
  location.replace(retryUrl(toolId));
}

function resumeRetriedTool(): void {
  const toolId = pendingRetryToolId();
  if (!toolId) return;

  /* Wait for a connected real trigger instead of depending on one microtask or
   * browser-specific document restoration timing. Keep the marker until the
   * click is actually dispatched, then consume both URL/session fallbacks. */
  let attempts = 0;
  const resume = (): void => {
    const escapedToolId = CSS.escape(toolId);
    const trigger = document.querySelector<HTMLElement>(`#tool-grid [data-open-tool="${escapedToolId}"]`)
      ?? document.querySelector<HTMLElement>(`[data-open-tool="${escapedToolId}"]`);

    if (!trigger?.isConnected) {
      attempts += 1;
      if (attempts < 120) requestAnimationFrame(resume);
      else clearRetryMarker();
      return;
    }

    trigger.click();
    clearRetryMarker();
  };

  const begin = (): void => {
    requestAnimationFrame(() => requestAnimationFrame(resume));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin, { once: true });
  else begin();
}

function wheelDeltaPixels(event: WheelEvent, body: HTMLElement): number {
  if (event.deltaMode === event.DOM_DELTA_LINE) return event.deltaY * 16;
  if (event.deltaMode === event.DOM_DELTA_PAGE) return event.deltaY * Math.max(body.clientHeight, 1);
  return event.deltaY;
}

function canConsumeVerticalWheel(element: HTMLElement, deltaY: number): boolean {
  const maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
  if (maxTop <= 1) return false;
  if (deltaY > 0) return element.scrollTop < maxTop - 1;
  if (deltaY < 0) return element.scrollTop > 1;
  return false;
}

function routeStackedEditorWheel(event: WheelEvent): void {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.deltaY === 0) return;
  if (!window.matchMedia(STACKED_EDITOR_QUERY).matches) return;

  const target = event.target instanceof Element ? event.target : null;
  const body = target?.closest<HTMLElement>('.legacy-editor-body');
  if (!body) return;

  /* Preserve local pane/canvas scrolling while it still has room. At a nested
   * boundary (or when the hovered child has no vertical overflow), explicitly
   * advance the stacked editor body. Chromium/WebKit do not consistently chain
   * wheel input from these nested overflow regions on mobile-sized viewports. */
  const nested = target?.closest<HTMLElement>(NESTED_VERTICAL_SCROLL_OWNERS);
  if (nested && nested !== body && body.contains(nested) && canConsumeVerticalWheel(nested, event.deltaY)) return;

  const maxTop = Math.max(0, body.scrollHeight - body.clientHeight);
  if (maxTop <= 1) return;
  const delta = wheelDeltaPixels(event, body);
  const nextTop = Math.max(0, Math.min(maxTop, body.scrollTop + delta));
  if (Math.abs(nextTop - body.scrollTop) < 0.5) return;

  body.scrollTop = nextTop;
  event.preventDefault();
}

export function installEditorLifecycleHardening(): void {
  if (installed) return;
  installed = true;

  /* Capture before createApp's bubbling handlers so we retain the exact control
   * that opened the workspace and can restore focus synchronously on close. */
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const retry = target.closest<HTMLElement>('[data-load-retry]');
    const errorPanel = retry?.closest<HTMLElement>('[data-load-error-for]');
    if (retry && errorPanel) {
      retryFailedModule(errorPanel, event);
      return;
    }

    rememberOpenTrigger(target);
  }, true);

  document.addEventListener('wheel', routeStackedEditorWheel, { capture: true, passive: false });

  workspaceDialog()?.addEventListener('close', () => {
    /* createApp currently queues its own restoration. Performing the same
     * restoration synchronously removes a Chromium race where a following
     * keyboard action could focus another control before that microtask ran. */
    focusOpeningControl();
  });

  resumeRetriedTool();
}
