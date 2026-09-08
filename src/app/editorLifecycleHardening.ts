const RETRY_TOOL_KEY = 'docflow.retry-tool.v1';

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

function retryFailedModule(errorPanel: HTMLElement, event: Event): void {
  const toolId = errorPanel.dataset.loadErrorFor;
  if (!toolId) return;

  /* A rejected native dynamic import may remain rejected in the browser's
   * module map for the lifetime of the page. A same-document second import is
   * therefore not a reliable recovery path. Persist only the tool id, reload
   * the app shell, and automatically reopen that tool once on the fresh page.
   * No PDF/image bytes are stored or replayed. */
  event.preventDefault();
  event.stopImmediatePropagation();
  sessionStorage.setItem(RETRY_TOOL_KEY, toolId);
  location.reload();
}

function resumeRetriedTool(): void {
  const toolId = sessionStorage.getItem(RETRY_TOOL_KEY);
  if (!toolId) return;
  sessionStorage.removeItem(RETRY_TOOL_KEY);

  queueMicrotask(() => {
    const trigger = document.querySelector<HTMLElement>(`#tool-grid [data-open-tool="${CSS.escape(toolId)}"]`)
      ?? document.querySelector<HTMLElement>(`[data-open-tool="${CSS.escape(toolId)}"]`);
    trigger?.click();
  });
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

  workspaceDialog()?.addEventListener('close', () => {
    /* createApp currently queues its own restoration. Performing the same
     * restoration synchronously removes a Chromium race where a following
     * keyboard action could focus another control before that microtask ran. */
    focusOpeningControl();
  });

  resumeRetriedTool();
}
