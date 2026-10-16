import { workspaceRuntime } from '../app/workspaceRuntime';
import '../styles/batch.css';
import '../styles/workflows.css';
import type { ToolDefinition } from './registry';
import { runWorkerOperation, type RunningOperation } from '../pdf/workerClient';
import type { InputFile, OutputFile } from '../pdf/types';
import {
  WORKFLOW_OPERATIONS, DEFAULT_WORKFLOW_RECIPES, MAX_STEPS, MAX_FILES, MAX_RECIPES,
  MAX_BATCH_BYTES, MAX_FILE_BYTES, defaultOptions, readRecipes, storeRecipes,
  validateRecipe, executeWorkflow, type WorkflowStep, type WorkflowRecipe,
  type WorkflowOperation
} from '../workflows/workflowEngine';

type State = 'pending' | 'running' | 'complete' | 'failed' | 'cancelled';
interface QueueFile {
  id: string;
  file: File;
  state: State;
  detail: string;
  output?: OutputFile;
}
interface EditField {
  name: string;
  label: string;
  type: 'select' | 'number' | 'text';
  choices?: ReadonlyArray<[string, string]>;
  min?: number;
  max?: number;
  step?: string;
}
const SPEC: Record<WorkflowOperation, EditField[]> = {
  rotate: [
    { name: 'target', label: 'Apply to', type: 'select', choices: [['all','All pages'],['odd','Odd pages'],['even','Even pages'],['selected','Selected pages']] },
    { name: 'pages', label: 'Page selection', type: 'text' },
    { name: 'degrees', label: 'Rotation', type: 'select', choices: [['90','90°'],['180','180°'],['270','270°']] }
  ],
  'page-numbers': [
    { name: 'pages', label: 'Pages (blank = all)', type: 'text' },
    { name: 'start', label: 'Start at', type: 'number', min: 1, max: 9999 },
    { name: 'format', label: 'Format', type: 'select', choices: [['page-total','Page 1 of N'],['fraction','1 / N'],['page','Page 1'],['number','1']] },
    { name: 'fontSize', label: 'Size (pt)', type: 'number', min: 6, max: 72 },
    { name: 'margin', label: 'Bottom margin (pt)', type: 'number', min: 4, max: 200 }
  ],
  watermark: [
    { name: 'text', label: 'Watermark text', type: 'text' },
    { name: 'opacity', label: 'Opacity', type: 'number', min: .05, max: 1, step: '.05' },
    { name: 'rotation', label: 'Rotation', type: 'number', min: -180, max: 180 },
    { name: 'fontSize', label: 'Text size (pt)', type: 'number', min: 12, max: 120 }
  ],
  crop: [
    { name: 'pages', label: 'Pages (blank = all)', type: 'text' },
    { name: 'left', label: 'Left margin (pt)', type: 'number', min: 0, max: 5000 },
    { name: 'right', label: 'Right margin (pt)', type: 'number', min: 0, max: 5000 },
    { name: 'top', label: 'Top margin (pt)', type: 'number', min: 0, max: 5000 },
    { name: 'bottom', label: 'Bottom margin (pt)', type: 'number', min: 0, max: 5000 }
  ],
  'metadata-edit': [
    { name: 'action', label: 'Change', type: 'select', choices: [['edit','Edit selected properties'],['clear','Clear standard properties']] },
    { name: 'title', label: 'Title (blank = unchanged)', type: 'text' },
    { name: 'author', label: 'Author (blank = unchanged)', type: 'text' },
    { name: 'subject', label: 'Subject (blank = unchanged)', type: 'text' },
    { name: 'creator', label: 'Creator (blank = unchanged)', type: 'text' },
    { name: 'keywords', label: 'Keywords (comma separated)', type: 'text' }
  ],
  'remove-pages': [ { name: 'pages', label: 'Remove pages (e.g., 2,4-5)', type: 'text' } ],
  optimize: [
    { name: 'quality', label: 'JPEG quality (35–100)', type: 'number', min: 35, max: 100 }
  ]
};
const initialStep = (operation: WorkflowOperation = 'rotate'): WorkflowStep => ({
  id: crypto.randomUUID(), operation, options: defaultOptions(operation)
});
function bytes(value: number): string {
  if (value < 1024) return value + ' B';
  return (value / 1048576).toFixed(1) + ' MB';
}
function baseName(value: string): string {
  return value.replace(/\.pdf$/i, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 72) || 'document';
}
const titleOf = (operation: WorkflowOperation): string =>
  WORKFLOW_OPERATIONS.find(item => item.id === operation)?.label ?? operation;

export function mountWorkspace(root: HTMLDivElement, _tool: ToolDefinition): void {
  const runtime = workspaceRuntime(root);
  root.innerHTML = '<div class="batch-workspace wf-workspace">' +
    '<aside class="batch-side wf-intro"><p class="eyebrow">WORKFLOWS · PRIVATE · REUSABLE</p>' +
    '<h2>Workflow builder</h2><p>Configure PDF actions once, run them in order on one or more PDFs, and download the finished results.</p>' +
    '<div class="privacy-box"><strong>Documents stay on your device</strong><span>Each step uses the existing local PDF worker. Saved recipes include only their configuration—never PDF contents, filenames or results.</span></div>' +
    '<div class="quality-box"><strong>Safe execution</strong><span>One file and one step at a time, a maximum of eight steps and twenty files. Failed files can be retried from their originals.</span></div>' +
    '<p class="wf-note">Crop hides content but is not redaction. Remove pages really removes pages. Optimisation may recompress supported images; always review exports.</p></aside>' +
    '<section class="batch-main wf-main">' +
    '<header class="wf-heading"><div><p class="eyebrow">BUILD YOUR WORKFLOW</p><h2>Automate document tasks</h2><p>Choose a preset or build a reusable sequence.</p></div><span class="wf-local-tag">Local processing</span></header>' +
    '<div class="wf-presets"><label>Saved & starter recipes<select id="wf-recipes" aria-label="Workflow presets"></select></label>' +
    '<button type="button" class="secondary" id="wf-apply">Load recipe</button>' +
    '<button type="button" class="secondary" id="wf-delete" disabled>Delete saved recipe</button></div>' +
    '<div class="wf-name"><label for="wf-name">Workflow name</label><input id="wf-name" maxlength="60" autocomplete="off" value="My workflow"><button type="button" class="secondary" id="wf-save">Save preset on this device</button></div>' +
    '<div class="wf-section-head"><h3>Steps <span id="wf-count">0 / 8</span></h3><p>Top to bottom · consecutive PDF outputs feed into the next step</p></div>' +
    '<div id="wf-steps" class="wf-steps" aria-label="Workflow steps"></div>' +
    '<div class="wf-add"><label for="wf-new-operation">Add an operation</label><select id="wf-new-operation"></select><button type="button" class="secondary" id="wf-add">Add step</button></div>' +
    '<div class="wf-files"><h3>Documents</h3><p>Pick up to 20 PDFs (50 MB each; 150 MB combined). Nothing is uploaded.</p>' +
    '<div class="batch-drop wf-drop" role="group" aria-label="Choose PDF files">' +
    '<label for="wf-input"><strong>Drop PDF files here or browse</strong></label><input id="wf-input" type="file" accept=".pdf,application/pdf" multiple></div></div>' +
    '<p class="wf-recipe-note">Presets are saved locally only when you select Save. They may contain watermark text or document properties; avoid saving sensitive text in shared browsers.</p>' +
    '<div class="operation-status" aria-live="polite"><div class="status-line"><span id="wf-stage">Ready</span><span id="wf-percent">0%</span></div>' +
    '<progress id="wf-progress" max="100" value="0"></progress><div id="wf-error" class="error-box" role="alert" hidden></div></div>' +
    '<div class="batch-actions wf-actions"><button id="wf-cancel" class="secondary" type="button" disabled>Cancel</button>' +
    '<button id="wf-retry" class="secondary" type="button" disabled>Retry failed</button>' +
    '<button id="wf-run" class="primary" type="button">Run workflow</button>' +
    '<button id="wf-zip" class="secondary" type="button" disabled>Prepare ZIP</button></div>' +
    '<div id="wf-queue" class="batch-queue" aria-live="polite"></div><div id="wf-results" class="batch-results" aria-live="polite"></div>' +
    '</section></div>';

  const input = root.querySelector<HTMLInputElement>('#wf-input')!;
  const drop = root.querySelector<HTMLElement>('.wf-drop')!;
  const stepList = root.querySelector<HTMLElement>('#wf-steps')!;
  const addOp = root.querySelector<HTMLSelectElement>('#wf-new-operation')!;
  const add = root.querySelector<HTMLButtonElement>('#wf-add')!;
  const recipeName = root.querySelector<HTMLInputElement>('#wf-name')!;
  const recipeSelect = root.querySelector<HTMLSelectElement>('#wf-recipes')!;
  const load = root.querySelector<HTMLButtonElement>('#wf-apply')!;
  const save = root.querySelector<HTMLButtonElement>('#wf-save')!;
  const del = root.querySelector<HTMLButtonElement>('#wf-delete')!;
  const queue = root.querySelector<HTMLElement>('#wf-queue')!;
  const results = root.querySelector<HTMLElement>('#wf-results')!;
  const stage = root.querySelector<HTMLElement>('#wf-stage')!;
  const progress = root.querySelector<HTMLProgressElement>('#wf-progress')!;
  const percent = root.querySelector<HTMLElement>('#wf-percent')!;
  const errorBox = root.querySelector<HTMLElement>('#wf-error')!;
  const runButton = root.querySelector<HTMLButtonElement>('#wf-run')!;
  const retryButton = root.querySelector<HTMLButtonElement>('#wf-retry')!;
  const cancelButton = root.querySelector<HTMLButtonElement>('#wf-cancel')!;
  const zipButton = root.querySelector<HTMLButtonElement>('#wf-zip')!;
  const count = root.querySelector<HTMLElement>('#wf-count')!;

  let steps: WorkflowStep[] = DEFAULT_WORKFLOW_RECIPES[0]!.steps.map(step => ({ ...step, id: crypto.randomUUID(), options: { ...step.options } }));
  let recipes: WorkflowRecipe[] = [];
  try { recipes = readRecipes(localStorage); } catch { /* private browsing remains usable */ }
  let selectedPreset = '';
  let files: QueueFile[] = [];
  let running: RunningOperation | null = null;
  let cancelled = false;
  let locked = false;
  let disposed = false;
  let urls: string[] = [];
  let lastRecipe: WorkflowRecipe | null = null;
  const clearUrls = (): void => {
    for (const url of urls) URL.revokeObjectURL(url);
    urls = [];
  };
  const setError = (message = ''): void => {
    errorBox.hidden = !message;
    errorBox.textContent = message;
  };
  const setProgress = (message: string, value: number): void => {
    stage.textContent = message;
    progress.value = value;
    percent.textContent = Math.round(value) + '%';
  };
  const resetOutputs = (): void => {
    clearUrls();
    results.replaceChildren();
    files = files.map(item => ({ id: item.id, file: item.file, state: 'pending', detail: 'Ready' }));
    lastRecipe = null;
    renderQueue();
    retryButton.disabled = true;
    zipButton.disabled = true;
    setProgress('Ready', 0);
  };
  const allPresets = (): WorkflowRecipe[] => [...DEFAULT_WORKFLOW_RECIPES, ...recipes];
  const renderRecipes = (): void => {
    recipeSelect.replaceChildren();
    for (const preset of allPresets()) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.name + (preset.id.startsWith('built-in-') ? ' · starter' : ' · saved');
      recipeSelect.append(option);
    }
    if (selectedPreset && allPresets().some(p => p.id === selectedPreset)) recipeSelect.value = selectedPreset;
    else selectedPreset = recipeSelect.value;
    del.disabled = locked || selectedPreset.startsWith('built-in-');
  };
  const updateLocked = (state: boolean): void => {
    runtime.busy(state);
    locked = state;
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
      'input, select, button'
    ).forEach(control => {
      control.disabled = state;
    });
    cancelButton.disabled = !state;
    if (!state) {
      retryButton.disabled = !files.some(item => item.state === 'failed' || item.state === 'cancelled');
      zipButton.disabled = !files.some(item => item.state === 'complete' && item.output);
      del.disabled = selectedPreset.startsWith('built-in-');
      add.disabled = steps.length >= MAX_STEPS;
    }
    renderQueue();
    renderSteps();
  };

  const updateStep = (index: number, key: string, raw: string, control: HTMLInputElement | HTMLSelectElement): void => {
    if (locked || !steps[index]) return;
    const value = (control instanceof HTMLInputElement && control.type === 'number') || key === 'degrees' ? Number(raw) : raw;
    steps[index]!.options[key] = value;
    resetOutputs();
  };
  const renderSteps = (): void => {
    stepList.replaceChildren();
    count.textContent = steps.length + ' / ' + MAX_STEPS;
    add.disabled = locked || steps.length >= MAX_STEPS;
    for (const [index, step] of steps.entries()) {
      const wrap = document.createElement('section');
      wrap.className = 'wf-step';
      wrap.dataset.step = step.id;
      const header = document.createElement('div');
      header.className = 'wf-step-top';
      const title = document.createElement('strong');
      title.textContent = (index + 1) + '. ' + titleOf(step.operation);
      const controls = document.createElement('div');
      controls.className = 'wf-step-actions';
      for (const [action, label, disabled] of [
        ['up', 'Move up', index === 0],
        ['down', 'Move down', index === steps.length - 1],
        ['remove', 'Remove step', false]
      ] as const) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary';
        button.textContent = label;
        button.dataset.stepAction = action;
        button.dataset.stepIndex = String(index);
        button.disabled = locked || disabled;
        button.setAttribute('aria-label', label + ' ' + (index + 1) + ': ' + titleOf(step.operation));
        controls.append(button);
      }
      header.append(title, controls);
      const description = document.createElement('p');
      description.className = 'wf-description';
      description.textContent = WORKFLOW_OPERATIONS.find(def => def.id === step.operation)?.description ?? '';
      const form = document.createElement('div');
      form.className = 'wf-step-fields';
      for (const field of SPEC[step.operation]) {
        const label = document.createElement('label');
        const id = 'wf-' + step.id + '-' + field.name;
        label.htmlFor = id;
        label.textContent = field.label;
        const value = step.options[field.name] ?? defaultOptions(step.operation)[field.name] ?? '';
        let control: HTMLSelectElement | HTMLInputElement;
        if (field.type === 'select') {
          control = document.createElement('select');
          for (const [optionValue, optionName] of field.choices ?? []) {
            const option = document.createElement('option');
            option.value = optionValue;
            option.textContent = optionName;
            control.append(option);
          }
        } else {
          control = document.createElement('input');
          control.type = field.type;
          if (field.type === 'number') {
            if (field.min !== undefined) control.min = String(field.min);
            if (field.max !== undefined) control.max = String(field.max);
            control.step = field.step ?? '1';
          } else {
            control.maxLength = field.name === 'pages' ? 180 : field.name === 'text' ? 180 : 512;
            control.autocomplete = 'off';
          }
        }
        control.id = id;
        control.value = String(value);
        control.dataset.stepIndex = String(index);
        control.dataset.optionKey = field.name;
        label.append(control);
        form.append(label);
      }
      wrap.append(header, description, form);
      stepList.append(wrap);
    }
  };
  const renderQueue = (): void => {
    runtime.inputs(files.map(item => item.file));
    queue.replaceChildren();
    if (!files.length) {
      const empty = document.createElement('p');
      empty.className = 'quick-empty';
      empty.textContent = 'Add PDFs to build your processing queue.';
      queue.append(empty);
    }
    for (const [index, item] of files.entries()) {
      const row = document.createElement('div');
      row.className = 'batch-row';
      row.dataset.state = item.state;
      row.dataset.fileId = item.id;
      const info = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = item.file.name;
      const meta = document.createElement('small');
      meta.textContent = bytes(item.file.size) + ' · File ' + (index + 1);
      const state = document.createElement('span');
      state.className = 'batch-state';
      state.textContent = item.detail;
      info.append(name, meta, state);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary';
      remove.textContent = 'Remove';
      remove.dataset.removeFile = item.id;
      remove.disabled = locked;
      row.append(info, remove);
      queue.append(row);
    }
  };
  const renderResults = (): void => {
    clearUrls();
    results.replaceChildren();
    for (const [index, item] of files.entries()) {
      if (item.state !== 'complete' || !item.output) continue;
      const name = baseName(item.file.name) + '-' + (index + 1) + '-workflow.pdf';
      const url = URL.createObjectURL(new Blob([item.output.buffer], { type: 'application/pdf' }));
      urls.push(url);
      const link = document.createElement('a');
      link.className = 'download';
      link.href = url;
      link.download = name;
      link.textContent = 'Download ' + name + ' (' + bytes(item.output.buffer.byteLength) + ')';
      results.append(link);
    }
    zipButton.disabled = locked || !files.some(item => item.state === 'complete' && item.output);
    retryButton.disabled = locked || !files.some(item => item.state === 'failed' || item.state === 'cancelled');
  };
  const addFiles = (incoming: FileList | File[]): void => {
    if (locked) return;
    let rejected = 0;
    let total = files.reduce((sum, item) => sum + item.file.size, 0);
    const known = new Set(files.map(item => item.file.name + ':' + item.file.size + ':' + item.file.lastModified));
    for (const file of [...incoming]) {
      const fingerprint = file.name + ':' + file.size + ':' + file.lastModified;
      if (known.has(fingerprint)) continue;
      if (file.size > MAX_FILE_BYTES || total + file.size > MAX_BATCH_BYTES ||
          files.length >= MAX_FILES || file.size === 0 ||
          !(file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))) {
        rejected++;
        continue;
      }
      files.push({ id: crypto.randomUUID(), file, state: 'pending', detail: 'Ready' });
      known.add(fingerprint);
      total += file.size;
    }
    if (rejected) setError(rejected + ' file(s) rejected. Only PDFs within the 20-file / 50-MB-each / 150-MB-total limits are supported.');
    else setError();
    resetOutputs();
  };
  const getDraft = (): WorkflowRecipe => validateRecipe({
    id: 'draft-workflow',
    name: recipeName.value,
    steps
  });
  const runQueue = async (retryOnly = false): Promise<void> => {
    if (locked) return;
    if (!files.length) { setError('Select one or more PDF files first.'); return; }
    let recipe: WorkflowRecipe;
    try {
      recipe = retryOnly && lastRecipe ? lastRecipe : getDraft();
      if (!retryOnly) lastRecipe = recipe;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Invalid workflow configuration.');
      return;
    }
    if (!retryOnly) {
      clearUrls();
      results.replaceChildren();
      files.forEach(item => { item.output = undefined; item.state = 'pending'; item.detail = 'Pending'; });
    } else {
      files.filter(item => item.state === 'failed' || item.state === 'cancelled').forEach(item => {
        item.state = 'pending'; item.detail = 'Retry from original';
      });
    }
    const targets = files.filter(item => item.state === 'pending');
    if (!targets.length) { setError('There are no failed files to retry.'); return; }
    cancelled = false;
    setError();
    updateLocked(true);
    let succeeded = 0;
    let failures = 0;
    for (const [fileIndex, item] of targets.entries()) {
      if (cancelled || disposed) {
        item.state = 'cancelled'; item.detail = 'Cancelled before processing';
        continue;
      }
      item.state = 'running';
      item.detail = 'Preparing';
      renderQueue();
      try {
        const initial: InputFile = { name: item.file.name, type: 'application/pdf', buffer: await item.file.arrayBuffer() };
        if (cancelled || disposed) throw new DOMException('Workflow cancelled', 'AbortError');
        const result = await executeWorkflow(
          initial, recipe.steps, runWorkerOperation,
          () => cancelled || disposed,
          event => {
            const overall = ((fileIndex + event.percent / 100) / targets.length) * 100;
            item.detail = 'Step ' + event.step + '/' + event.totalSteps + ': ' + event.message;
            setProgress('File ' + (fileIndex + 1) + '/' + targets.length + ' · ' + item.detail, overall);
            const stateNode = queue.querySelector<HTMLElement>('[data-file-id="' + item.id + '"] .batch-state');
            if (stateNode) stateNode.textContent = item.detail;
          }, handle => { running = handle; }
        );
        if (cancelled || disposed) throw new DOMException('Workflow cancelled', 'AbortError');
        item.output = result;
        item.state = 'complete';
        item.detail = 'Completed ' + recipe.steps.length + ' step(s)';
        succeeded++;
      } catch (error) {
        if (cancelled || disposed || (error instanceof DOMException && error.name === 'AbortError')) {
          cancelled = true;
          item.state = 'cancelled';
          item.detail = 'Cancelled · retry starts from original';
        } else {
          failures++;
          item.state = 'failed';
          item.detail = 'Failed: ' + (error instanceof Error ? error.message : 'Unknown error');
        }
      } finally {
        running = null;
        if (!disposed) renderQueue();
      }
    }
    if (disposed) return;
    renderResults();
    if (!cancelled) runtime.result({ outputs: files.filter(item => item.state === 'complete' && item.output).map(item => item.output!) });
    updateLocked(false);
    setProgress(cancelled ? 'Cancelled · ' + succeeded + ' completed' :
      'Finished · ' + succeeded + ' completed' + (failures ? ', ' + failures + ' failed' : ''), cancelled ? Math.min(99, succeeded / targets.length * 100) : 100);
  };
  const zip = async (): Promise<void> => {
    if (locked) return;
    const completed = files.filter(item => item.state === 'complete' && item.output);
    if (!completed.length) return;
    zipButton.disabled = true;
    try {
      const { default: JSZip } = await import('jszip');
      const archive = new JSZip();
      for (const item of completed) {
        const index = files.indexOf(item) + 1;
        archive.file(baseName(item.file.name) + '-' + index + '-workflow.pdf', item.output!.buffer);
      }
      const blob = await archive.generateAsync({
        type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 4 }
      }, metadata => setProgress('Preparing ZIP', Math.min(99, metadata.percent)));
      if (disposed) return;
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const link = document.createElement('a');
      link.className = 'download';
      link.download = 'docflow-workflow-results.zip';
      link.href = url;
      link.textContent = 'Download workflow ZIP (' + bytes(blob.size) + ')';
      results.prepend(link);
      setProgress('ZIP ready · ' + completed.length + ' file(s)', 100);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'ZIP preparation failed.');
    } finally { if (!disposed) zipButton.disabled = false; }
  };

  addOp.replaceChildren();
  for (const operation of WORKFLOW_OPERATIONS) {
    const choice = document.createElement('option');
    choice.value = operation.id;
    choice.textContent = operation.label;
    addOp.append(choice);
  }
  renderRecipes();
  recipeName.value = 'Prepare for sharing';
  renderSteps();
  renderQueue();

  const stepChange = (event: Event): void => {
    const control = event.target;
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) return;
    if (!control.dataset.optionKey || !control.dataset.stepIndex) return;
    updateStep(Number(control.dataset.stepIndex), control.dataset.optionKey, control.value, control);
  };
  stepList.addEventListener('change', stepChange);
  stepList.addEventListener('input', event => {
    if (event.target instanceof HTMLInputElement && event.target.type === 'text') stepChange(event);
  });
  stepList.addEventListener('click', event => {
    if (locked) return;
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-step-action]');
    if (!button) return;
    const index = Number(button.dataset.stepIndex);
    if (button.dataset.stepAction === 'remove') {
      steps.splice(index, 1);
    } else {
      const other = button.dataset.stepAction === 'up' ? index - 1 : index + 1;
      if (other < 0 || other >= steps.length) return;
      [steps[index], steps[other]] = [steps[other]!, steps[index]!];
    }
    resetOutputs();
    renderSteps();
  });
  add.addEventListener('click', () => {
    if (locked || steps.length >= MAX_STEPS) return;
    steps.push(initialStep(addOp.value as WorkflowOperation));
    resetOutputs();
    renderSteps();
    stepList.lastElementChild?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  });
  recipeSelect.addEventListener('change', () => {
    selectedPreset = recipeSelect.value;
    del.disabled = locked || selectedPreset.startsWith('built-in-');
  });
  load.addEventListener('click', () => {
    if (locked) return;
    const chosen = allPresets().find(item => item.id === recipeSelect.value);
    if (!chosen) return;
    steps = chosen.steps.map(step => ({ id: crypto.randomUUID(), operation: step.operation, options: { ...step.options } }));
    recipeName.value = chosen.name;
    resetOutputs();
    renderSteps();
    setError();
  });
  save.addEventListener('click', () => {
    if (locked) return;
    try {
      const recipe = getDraft();
      const id = selectedPreset.startsWith('built-in-') || !recipes.some(item => item.id === selectedPreset)
        ? crypto.randomUUID() : selectedPreset;
      const named = { ...recipe, id };
      const updated = recipes.some(item => item.id === id)
        ? recipes.map(item => item.id === id ? named : item)
        : [...recipes, named];
      if (updated.length > MAX_RECIPES) throw Error('Preset limit reached (15). Delete an old preset.');
      storeRecipes(localStorage, updated);
      recipes = updated;
      selectedPreset = id;
      renderRecipes();
      setError();
      setProgress('Preset saved locally · PDFs were not saved', 0);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save preset. Local storage may be blocked.');
    }
  });
  del.addEventListener('click', () => {
    if (locked || selectedPreset.startsWith('built-in-')) return;
    try {
      const updated = recipes.filter(item => item.id !== selectedPreset);
      storeRecipes(localStorage, updated);
      recipes = updated;
      selectedPreset = DEFAULT_WORKFLOW_RECIPES[0]!.id;
      renderRecipes();
      setProgress('Saved preset removed from this device', 0);
      setError();
    } catch { setError('Could not delete preset because storage is unavailable.'); }
  });
  input.addEventListener('change', () => { if (input.files) addFiles(input.files); input.value = ''; });
  for (const kind of ['dragenter','dragover']) drop.addEventListener(kind, event => { event.preventDefault(); drop.classList.add('dragging'); });
  for (const kind of ['dragleave','drop']) drop.addEventListener(kind, event => { event.preventDefault(); drop.classList.remove('dragging'); });
  drop.addEventListener('drop', event => { if (event.dataTransfer?.files) addFiles(event.dataTransfer.files); });
  queue.addEventListener('click', event => {
    if (locked) return;
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-remove-file]');
    if (!button) return;
    files = files.filter(item => item.id !== button.dataset.removeFile);
    resetOutputs();
  });
  runButton.addEventListener('click', () => { void runQueue(false); });
  retryButton.addEventListener('click', () => { void runQueue(true); });
  cancelButton.addEventListener('click', () => {
    cancelled = true;
    running?.cancel();
  });
  zipButton.addEventListener('click', () => { void zip(); });
  const beforeUnload = (event: BeforeUnloadEvent): void => {
    if (!locked) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', beforeUnload);
  root.addEventListener('docflow-cleanup', () => {
    disposed = true;
    cancelled = true;
    running?.cancel();
    running = null;
    clearUrls();
    files = [];
    steps = [];
    window.removeEventListener('beforeunload', beforeUnload);
  }, { once: true });
}
