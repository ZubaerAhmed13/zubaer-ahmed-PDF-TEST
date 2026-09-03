import type { ToolDefinition } from './registry';
import { mountWorkspace as mountRecoveredWorkspace } from './workspaceWithRecovery';
import { runWorkerOperation, type RunningOperation } from '../pdf/workerClient';
import type { InputFile, OperationProgress, OperationResult } from '../pdf/types';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character] ?? character));
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
  mountRecoveredWorkspace(container, tool);

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

  const modePanel = document.createElement('div');
  modePanel.className = 'watermark-mode-panel';
  modePanel.innerHTML = `
    <label>Watermark type
      <select name="watermarkMode" aria-label="Watermark type">
        <option value="text">Text watermark</option>
        <option value="image">Image watermark</option>
      </select>
    </label>
    <div data-image-watermark-controls hidden>
      <label>Watermark image
        <input id="watermark-image-file" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg">
      </label>
      <div class="help" data-watermark-image-name>No watermark image selected. PNG and JPEG are supported and processed locally.</div>
      <label>Image width (% of page)
        <input name="imageWidthPercent" type="number" min="5" max="90" step="1" value="25">
      </label>
      <label>Position
        <select name="imagePosition">
          <option value="center">Center</option>
          <option value="top-left">Top left</option>
          <option value="top">Top center</option>
          <option value="top-right">Top right</option>
          <option value="left">Middle left</option>
          <option value="right">Middle right</option>
          <option value="bottom-left">Bottom left</option>
          <option value="bottom">Bottom center</option>
          <option value="bottom-right">Bottom right</option>
        </select>
      </label>
      <label>Edge margin (pt)
        <input name="imageMargin" type="number" min="0" max="240" step="1" value="24">
      </label>
      <p class="help">The image is embedded once and drawn onto each page without rasterizing the existing PDF page content. The original watermark image file is not stored in recovery state.</p>
    </div>
  `;
  form.insertAdjacentElement('afterbegin', modePanel);

  const mode = form.querySelector<HTMLSelectElement>('select[name="watermarkMode"]');
  const imageControls = form.querySelector<HTMLElement>('[data-image-watermark-controls]');
  const imageInput = form.querySelector<HTMLInputElement>('#watermark-image-file');
  const imageName = form.querySelector<HTMLElement>('[data-watermark-image-name]');
  const textLabel = form.querySelector<HTMLInputElement>('input[name="text"]')?.closest<HTMLElement>('label') ?? null;
  const fontSizeLabel = form.querySelector<HTMLInputElement>('input[name="fontSize"]')?.closest<HTMLElement>('label') ?? null;
  if (!mode || !imageControls || !imageInput || !imageName) return;

  let sourcePdf: File | null = null;
  let running: RunningOperation | null = null;
  let outputUrl: string | null = null;
  let disposed = false;

  const clearOutputUrl = (): void => {
    if (!outputUrl) return;
    URL.revokeObjectURL(outputUrl);
    outputUrl = null;
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
    setProgress(update.message, Math.min(96, update.percent));
  };

  const renderOutput = (operationResult: OperationResult): void => {
    clearOutputUrl();
    const output = operationResult.outputs[0];
    if (!output) throw new Error('The image-watermark operation returned no PDF output.');
    const blob = new Blob([output.buffer], { type: output.type });
    outputUrl = URL.createObjectURL(blob);
    result.innerHTML = `<a class="download" href="${outputUrl}" download="${escapeHtml(output.name)}">Download ${escapeHtml(output.name)} <span>${humanBytes(blob.size)}</span></a>`;
  };

  const toggleMode = (): void => {
    const imageMode = mode.value === 'image';
    imageControls.hidden = !imageMode;
    if (textLabel) textLabel.hidden = imageMode;
    if (fontSizeLabel) fontSizeLabel.hidden = imageMode;
  };

  const captureSourcePdf = (files: FileList | File[]): void => {
    const file = [...files][0] ?? null;
    sourcePdf = file && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) ? file : null;
  };

  const executeImageWatermark = async (): Promise<void> => {
    if (disposed || running) return;
    if (!sourcePdf) { setError('Choose a PDF first.'); return; }
    const watermarkImage = imageInput.files?.[0] ?? null;
    if (!watermarkImage) { setError('Choose a PNG or JPEG watermark image.'); return; }
    if (!(/image\/(png|jpeg)/.test(watermarkImage.type) || /\.png$|\.jpe?g$/i.test(watermarkImage.name))) {
      setError('The watermark image must be PNG or JPEG.');
      return;
    }

    setError();
    clearOutputUrl();
    result.replaceChildren();
    runButton.disabled = true;
    cancelButton.disabled = false;
    setProgress('Preparing image watermark', 4);

    try {
      const files = await Promise.all([inputFile(sourcePdf), inputFile(watermarkImage)]);
      const options = {
        opacity: Number((form.elements.namedItem('opacity') as HTMLInputElement | null)?.value ?? 0.35),
        rotation: Number((form.elements.namedItem('rotation') as HTMLInputElement | null)?.value ?? 0),
        imageWidthPercent: Number((form.elements.namedItem('imageWidthPercent') as HTMLInputElement | null)?.value ?? 25),
        imagePosition: (form.elements.namedItem('imagePosition') as HTMLSelectElement | null)?.value ?? 'center',
        imageMargin: Number((form.elements.namedItem('imageMargin') as HTMLInputElement | null)?.value ?? 24)
      };
      running = runWorkerOperation('watermark-image', files, options, renderProgress);
      const operationResult = await running.result;
      if (disposed) return;
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
        setError('The image-watermark operation failed.');
      }
    } finally {
      running = null;
      if (!disposed) {
        runButton.disabled = false;
        cancelButton.disabled = true;
      }
    }
  };

  const onCaptureChange = (event: Event): void => {
    if (event.target === mainInput && mainInput.files) captureSourcePdf(mainInput.files);
    if (event.target === imageInput) {
      const file = imageInput.files?.[0];
      imageName.textContent = file ? `${file.name} — ${humanBytes(file.size)}` : 'No watermark image selected. PNG and JPEG are supported and processed locally.';
    }
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
      if (mode.value !== 'image') { clearOutputUrl(); return; }
      event.preventDefault();
      event.stopImmediatePropagation();
      void executeImageWatermark();
      return;
    }
    if (target.closest('#cancel-operation') && running) {
      event.preventDefault();
      event.stopImmediatePropagation();
      running.cancel();
    }
  };

  mode.addEventListener('change', toggleMode);
  container.addEventListener('change', onCaptureChange, true);
  container.addEventListener('drop', onCaptureDrop, true);
  container.addEventListener('click', onCaptureClick, true);
  toggleMode();

  container.addEventListener('docflow-cleanup', () => {
    disposed = true;
    running?.cancel();
    running = null;
    clearOutputUrl();
    mode.removeEventListener('change', toggleMode);
    container.removeEventListener('change', onCaptureChange, true);
    container.removeEventListener('drop', onCaptureDrop, true);
    container.removeEventListener('click', onCaptureClick, true);
  }, { once: true });
}
