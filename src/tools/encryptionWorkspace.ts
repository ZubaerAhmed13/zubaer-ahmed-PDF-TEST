import type { ToolDefinition } from './registry';
import { mountWorkspace as mountBaseWorkspace } from './workspace';
import { runQpdfOperation, type RunningQpdfOperation } from '../pdf/qpdfWorkerClient';
import type { InputFile, OperationProgress, OperationResult } from '../pdf/types';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[character] ?? character));
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB','MB','GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

async function inputFile(file: File): Promise<InputFile> {
  return { name: file.name, type: file.type, buffer: await file.arrayBuffer() };
}

export function mountWorkspace(container: HTMLDivElement, tool: ToolDefinition): void {
  // Use a PDF-only surrogate id for the shared shell. Encryption execution is intercepted below.
  mountBaseWorkspace(container, { ...tool, id: 'metadata' });

  const form = container.querySelector<HTMLFormElement>('#tool-options');
  const mainInput = container.querySelector<HTMLInputElement>('#workspace-file');
  const runButton = container.querySelector<HTMLButtonElement>('#run-operation');
  const cancelButton = container.querySelector<HTMLButtonElement>('#cancel-operation');
  const stage = container.querySelector<HTMLElement>('#stage');
  const percent = container.querySelector<HTMLElement>('#percent');
  const progress = container.querySelector<HTMLProgressElement>('#progress');
  const errorBox = container.querySelector<HTMLElement>('#error');
  const result = container.querySelector<HTMLElement>('#result');
  const dropZone = container.querySelector<HTMLElement>('.drop-zone');
  if (!form || !mainInput || !runButton || !cancelButton || !stage || !percent || !progress || !errorBox || !result || !dropZone) return;

  const protectMode = tool.id === 'protect-pdf';
  const securityPanel = document.createElement('div');
  securityPanel.className = 'encryption-panel';
  securityPanel.innerHTML = `
    <div class="notice">
      <strong>${protectMode ? 'AES-256 PDF encryption' : 'Password-based PDF unlock'}</strong>
      <p>${protectMode ? 'Encrypts the PDF locally with qpdf 12.3.2 using AES-256. Page content is not intentionally rasterized or recompressed.' : 'Removes PDF encryption locally with qpdf 12.3.2 after validating the supplied user or owner password.'}</p>
    </div>
    <label>${protectMode ? 'New password' : 'PDF password'}
      <input id="encryption-password" name="encryptionPassword" type="password" minlength="${protectMode ? '8' : '1'}" maxlength="127" autocomplete="${protectMode ? 'new-password' : 'current-password'}" required>
    </label>
    ${protectMode ? `<label>Confirm password
      <input id="encryption-password-confirm" name="encryptionPasswordConfirm" type="password" minlength="8" maxlength="127" autocomplete="new-password" required>
    </label>` : ''}
    <p class="help">Passwords are passed only to the active local qpdf worker. DocFlow does not save them to IndexedDB, localStorage, project recovery, analytics, or a remote processing service. Closing or completing this workspace clears these fields.</p>
  `;
  form.replaceChildren(securityPanel);

  const passwordInput = form.querySelector<HTMLInputElement>('#encryption-password');
  const confirmInput = form.querySelector<HTMLInputElement>('#encryption-password-confirm');
  if (!passwordInput) return;

  let sourcePdf: File | null = null;
  let running: RunningQpdfOperation | null = null;
  let outputUrl: string | null = null;
  let cancelled = false;
  let disposed = false;

  const clearOutputUrl = (): void => {
    if (!outputUrl) return;
    URL.revokeObjectURL(outputUrl);
    outputUrl = null;
  };

  const clearPasswords = (): void => {
    passwordInput.value = '';
    if (confirmInput) confirmInput.value = '';
  };

  const setError = (message = ''): void => {
    errorBox.hidden = !message;
    errorBox.textContent = message;
  };

  const setProgress = (message: string, value: number): void => {
    stage.textContent = message;
    progress.value = value;
    percent.textContent = `${Math.round(value)}%`;
  };

  const renderProgress = (update: OperationProgress): void => {
    setProgress(update.message, Math.min(98, update.percent));
  };

  const captureSourcePdf = (files: FileList | File[]): void => {
    const file = [...files][0] ?? null;
    sourcePdf = file && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) ? file : null;
  };

  const renderOutput = (operationResult: OperationResult): void => {
    clearOutputUrl();
    const output = operationResult.outputs[0];
    if (!output) throw new Error('The encryption operation returned no PDF output.');
    const blob = new Blob([output.buffer], { type: output.type });
    outputUrl = URL.createObjectURL(blob);
    const status = protectMode ? 'AES-256 protection applied locally.' : 'Encryption removed locally after password validation.';
    result.innerHTML = `<div class="notice"><strong>${protectMode ? 'Protected PDF ready' : 'Unlocked PDF ready'}</strong><p>${escapeHtml(status)} Password data was not persisted by DocFlow.</p></div><a class="download" href="${outputUrl}" download="${escapeHtml(output.name)}">Download ${escapeHtml(output.name)} <span>${humanBytes(blob.size)}</span></a>`;
  };

  const execute = async (): Promise<void> => {
    if (disposed || running) return;
    if (!sourcePdf) { setError('Choose a PDF first.'); return; }
    const password = passwordInput.value;
    const passwordBytes = new TextEncoder().encode(password).byteLength;
    if (!password) { setError('Enter the PDF password.'); passwordInput.focus(); return; }
    if (protectMode && passwordBytes < 8) { setError('Use a password with at least 8 UTF-8 bytes.'); passwordInput.focus(); return; }
    if (passwordBytes > 127) { setError('Password must be 127 UTF-8 bytes or fewer.'); passwordInput.focus(); return; }
    if (protectMode && confirmInput?.value !== password) { setError('Password confirmation does not match.'); confirmInput?.focus(); return; }

    setError();
    clearOutputUrl();
    result.replaceChildren();
    cancelled = false;
    runButton.disabled = true;
    cancelButton.disabled = false;
    setProgress('Preparing document locally', 4);

    try {
      const file = await inputFile(sourcePdf);
      if (cancelled) throw new DOMException('Operation cancelled', 'AbortError');
      running = runQpdfOperation(protectMode ? 'protect' : 'unlock', file, password, renderProgress);
      const operationResult = await running.result;
      if (disposed || cancelled) return;
      renderOutput(operationResult);
      setProgress('Complete', 100);
    } catch (error) {
      if (disposed) return;
      if (error instanceof DOMException && error.name === 'AbortError') {
        setProgress('Cancelled', 0);
        setError('Operation cancelled.');
      } else if (error instanceof Error) {
        setProgress('Failed', 0);
        setError(`${error.name !== 'Error' ? `${error.name}: ` : ''}${error.message}`);
      } else {
        setProgress('Failed', 0);
        setError('The encryption operation failed.');
      }
    } finally {
      running = null;
      clearPasswords();
      if (!disposed) {
        runButton.disabled = false;
        cancelButton.disabled = true;
      }
    }
  };

  const onCaptureChange = (event: Event): void => {
    if (event.target === mainInput && mainInput.files) captureSourcePdf(mainInput.files);
  };

  const onCaptureDrop = (event: DragEvent): void => {
    if (!(event.target instanceof Node) || !dropZone.contains(event.target)) return;
    if (event.dataTransfer?.files) captureSourcePdf(event.dataTransfer.files);
  };

  const onCaptureClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('[data-remove]')) sourcePdf = null;
    if (target.closest('#run-operation')) {
      event.preventDefault();
      event.stopPropagation();
      void execute();
      return;
    }
    if (target.closest('#cancel-operation')) {
      event.preventDefault();
      event.stopPropagation();
      cancelled = true;
      running?.cancel();
    }
  };

  container.addEventListener('change', onCaptureChange, true);
  container.addEventListener('drop', onCaptureDrop, true);
  container.addEventListener('click', onCaptureClick, true);

  container.addEventListener('docflow-cleanup', () => {
    disposed = true;
    cancelled = true;
    running?.cancel();
    running = null;
    clearPasswords();
    clearOutputUrl();
    container.removeEventListener('change', onCaptureChange, true);
    container.removeEventListener('drop', onCaptureDrop, true);
    container.removeEventListener('click', onCaptureClick, true);
  }, { once: true });
}
