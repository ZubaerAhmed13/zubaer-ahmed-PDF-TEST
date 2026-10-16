interface WorkState { busy: boolean; hasWork: boolean }
let readState: () => WorkState = () => ({ busy: false, hasWork: false });
let releaseWork: () => void = () => {};
let updateApproved = false;
let asking = false;

export function configureWorkProtection(read: () => WorkState, release: () => void): void {
  readState = read;
  releaseWork = release;
}

export function confirmAction(title: string, detail: string, action: string): Promise<boolean> {
  if (asking) return Promise.resolve(false);
  asking = true;
  const previous = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'session-confirm';
  dialog.setAttribute('aria-labelledby', 'session-confirm-title');
  dialog.setAttribute('aria-describedby', 'session-confirm-detail');
  const heading = document.createElement('h2'); heading.id = 'session-confirm-title'; heading.textContent = title;
  const text = document.createElement('p'); text.id = 'session-confirm-detail'; text.textContent = detail;
  const actions = document.createElement('div');
  const keep = document.createElement('button'); keep.type = 'button'; keep.className = 'secondary'; keep.textContent = 'Keep working';
  const accept = document.createElement('button'); accept.type = 'button'; accept.className = 'primary'; accept.textContent = action;
  actions.append(keep, accept); dialog.append(heading, text, actions); document.body.append(dialog);
  return new Promise(resolve => {
    const finish = (approved: boolean): void => {
      asking = false; dialog.remove();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
      resolve(approved);
    };
    keep.addEventListener('click', () => finish(false), { once: true });
    accept.addEventListener('click', () => finish(true), { once: true });
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); }, { once: true });
    dialog.showModal(); keep.focus();
  });
}

export async function approveReload(action = 'Reload and clear session'): Promise<boolean> {
  const state = readState();
  if (state.busy) {
    await confirmAction('Processing is still running', 'Finish or cancel the operation before updating or reloading DocFlow.', 'Return to document');
    return false;
  }
  return !state.hasWork || confirmAction('Clear this tab’s work?', 'Documents, results and history are kept only in memory. Export what you need before reloading. Files already downloaded stay on your device.', action);
}

export function prepareApprovedReload(): void { releaseWork(); }
export function allowWorkerUpdate(value: boolean): void { updateApproved = value; }

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type !== 'DOCFLOW_QUERY_WORK' || !event.ports[0]) return;
    const state = readState();
    // Only booleans cross the worker boundary. Never names, bytes or settings.
    event.ports[0].postMessage({ safe: !state.busy && (!state.hasWork || updateApproved) });
  });
}
