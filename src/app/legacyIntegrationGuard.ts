const trackedFiles = new WeakMap<HTMLElement, File[]>();
const replacementIndex = new WeakMap<HTMLElement, number>();
const rebuilding = new WeakSet<HTMLElement>();
let installed = false;

function workspaceRoot(target: Element): HTMLElement | null {
  return target.closest<HTMLElement>('.workspace');
}

function ensureDialogBar(): void {
  const dialog = document.querySelector<HTMLDialogElement>('#workspace-dialog');
  const workspace = document.querySelector<HTMLElement>('#workspace');
  if (!dialog || !workspace) return;

  let form = dialog.querySelector<HTMLFormElement>('.dialog-bar');
  if (!form) {
    form = document.createElement('form');
    form.method = 'dialog';
    form.className = 'dialog-bar';
    form.innerHTML = '<strong id="workspace-title">Workspace</strong><button aria-label="Close workspace">Close</button>';
  }

  // The native dialog form is lifecycle infrastructure. Keep it permanently
  // outside #workspace so workspace.replaceChildren() can never destroy the
  // only close control during repeated preview/open/close cycles.
  form.classList.remove('legacy-header-close-form');
  const nativeButton = form.querySelector<HTMLButtonElement>('button');
  if (nativeButton) {
    nativeButton.textContent = 'Close';
    nativeButton.removeAttribute('title');
  }
  if (form.parentElement !== dialog) dialog.insertBefore(form, workspace);

  const legacyHeaderActions = workspace.querySelector<HTMLElement>('.legacy-editor-header .legacy-header-actions');
  dialog.classList.toggle('legacy-exact-active', Boolean(legacyHeaderActions));
  if (!legacyHeaderActions) return;

  // The restored legacy editor gets a presentation-only header close button.
  // It closes the same native dialog, while the real form remains a stable
  // direct child of the dialog for lifecycle and accessibility fallbacks.
  let visualClose = legacyHeaderActions.querySelector<HTMLButtonElement>('[data-legacy-header-close]');
  if (!visualClose) {
    visualClose = document.createElement('button');
    visualClose.type = 'button';
    visualClose.className = 'legacy-favorite-button legacy-header-close-button';
    visualClose.dataset.legacyHeaderClose = 'true';
    visualClose.setAttribute('aria-label', 'Close workspace');
    visualClose.title = 'Close';
    visualClose.textContent = '×';
    visualClose.addEventListener('click', () => {
      if (dialog.open) dialog.close();
    });
    legacyHeaderActions.append(visualClose);
  }
}

function preserveRecoveryNodes(): void {
  document.querySelectorAll<HTMLElement>('.workspace .workspace-grid:not([data-legacy-exact="true"])').forEach((grid) => {
    const root = grid.closest<HTMLElement>('.workspace');
    if (!root) return;
    grid.querySelectorAll<HTMLElement>('[data-recovery-panel],[data-project-save-status]').forEach((node) => {
      if (node.parentElement !== root) root.append(node);
    });
  });
}

function makePlaceholdersDecorative(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-parity-trash],[data-parity-restore],[data-parity-undo],[data-parity-redo]').forEach((button) => {
    button.setAttribute('aria-hidden', 'true');
    button.tabIndex = -1;
    button.removeAttribute('aria-label');
  });
}

function rememberInputFiles(input: HTMLInputElement): void {
  if (!input.files?.length) return;
  const root = workspaceRoot(input);
  if (!root) return;
  const selected = [...input.files];
  if (rebuilding.has(root)) trackedFiles.set(root, selected);
  else trackedFiles.set(root, input.multiple ? [...(trackedFiles.get(root) ?? []), ...selected] : selected.slice(0, 1));
}

function rememberDrop(drop: HTMLElement, files: FileList): void {
  const root = workspaceRoot(drop);
  const input = drop.querySelector<HTMLInputElement>('#workspace-file');
  if (!root || !input || !files.length) return;
  const selected = [...files];
  trackedFiles.set(root, input.multiple ? [...(trackedFiles.get(root) ?? []), ...selected] : selected.slice(0, 1));
}

function removeTrackedFile(remove: HTMLElement): void {
  const root = workspaceRoot(remove);
  if (!root || rebuilding.has(root)) return;
  const row = remove.closest<HTMLElement>('.file-row');
  const rows = [...root.querySelectorAll<HTMLElement>('#file-list .file-row')];
  const index = row ? rows.indexOf(row) : -1;
  if (index < 0) return;
  const next = [...(trackedFiles.get(root) ?? [])];
  next.splice(index, 1);
  trackedFiles.set(root, next);
}

function clearCoreFileRows(root: HTMLElement): void {
  let guard = 0;
  while (guard < 1000) {
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('#file-list [data-remove]')];
    if (!buttons.length) break;
    buttons[buttons.length - 1]?.click();
    guard += 1;
  }
}

function replaceCoreFiles(root: HTMLElement, files: File[]): void {
  const input = root.querySelector<HTMLInputElement>('#workspace-file');
  if (!input) return;
  rebuilding.add(root);
  try {
    clearCoreFileRows(root);
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    trackedFiles.set(root, [...files]);
  } finally {
    queueMicrotask(() => rebuilding.delete(root));
  }
}

function handleMove(button: HTMLElement, event: Event): void {
  const root = workspaceRoot(button);
  if (!root) return;
  const files = [...(trackedFiles.get(root) ?? [])];
  const index = Number(button.dataset.parityIndex);
  const direction = Number(button.dataset.parityMove);
  const destination = index + direction;
  if (!Number.isInteger(index) || !Number.isInteger(destination) || index < 0 || destination < 0 || index >= files.length || destination >= files.length) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  [files[index], files[destination]] = [files[destination]!, files[index]!];
  replaceCoreFiles(root, files);
}

function handleReplace(button: HTMLElement, event: Event): void {
  const root = workspaceRoot(button);
  if (!root) return;
  const index = Number(button.dataset.parityReplace);
  if (!Number.isInteger(index) || index < 0) return;
  const input = root.querySelector<HTMLInputElement>('[data-parity-replacement-input]');
  if (!input) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  replacementIndex.set(root, index);
  input.click();
}

function handleReplacementInput(input: HTMLInputElement, event: Event): void {
  const root = workspaceRoot(input);
  const file = input.files?.[0];
  if (!root || !file) return;
  const index = replacementIndex.get(root);
  replacementIndex.delete(root);
  if (index === undefined) return;
  event.stopImmediatePropagation();
  const files = [...(trackedFiles.get(root) ?? [])];
  if (index >= files.length) return;
  files[index] = file;
  replaceCoreFiles(root, files);
  input.value = '';
}

function enhance(): void {
  ensureDialogBar();
  preserveRecoveryNodes();
  makePlaceholdersDecorative();
}

export function installLegacyIntegrationGuard(): void {
  if (installed) return;
  installed = true;

  const dialog = document.querySelector<HTMLDialogElement>('#workspace-dialog');
  dialog?.addEventListener('close', () => {
    ensureDialogBar();
    dialog.classList.remove('legacy-exact-active');
    const workspace = document.querySelector<HTMLElement>('#workspace');
    if (workspace) trackedFiles.delete(workspace);
  });

  const observer = new MutationObserver(enhance);
  observer.observe(document.body, { subtree: true, childList: true });
  enhance();

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.id === 'workspace-file') rememberInputFiles(target);
    else if (target.matches('[data-parity-replacement-input]')) handleReplacementInput(target, event);
  }, true);

  document.addEventListener('drop', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const drop = target?.closest<HTMLElement>('.drop-zone');
    if (drop && event.dataTransfer?.files.length) rememberDrop(drop, event.dataTransfer.files);
  }, true);

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const overviewClose = target.closest<HTMLElement>('[data-overview-close]');
    if (overviewClose) {
      const overlay = overviewClose.closest<HTMLElement>('.legacy-overview-overlay');
      // The native overview handler performs PDF.js cancellation/destruction.
      // This microtask is only a DOM fallback for a previously observed race
      // where cleanup had already disposed the state before removing its shell.
      queueMicrotask(() => {
        if (overlay?.isConnected) overlay.remove();
      });
      return;
    }

    const move = target.closest<HTMLElement>('[data-parity-move]');
    if (move) { handleMove(move, event); return; }
    const replace = target.closest<HTMLElement>('[data-parity-replace]');
    if (replace) { handleReplace(replace, event); return; }
    const remove = target.closest<HTMLElement>('#file-list [data-remove]');
    if (remove) removeTrackedFile(remove);
  }, true);
}
