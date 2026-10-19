import type { ToolDefinition } from './registry';
import { mountWorkspace as mountRecoveredWorkspace } from './workspaceWithRecovery';
import { createPreview, type PreviewController } from '../pdf/render';
import { workspaceRuntime } from '../app/workspaceRuntime';
import '../styles/visual-page-picker.css';

export function parsePageChoice(value: string, count: number): Set<number> | null {
  const selection = new Set<number>();
  if (!value.trim()) return selection;
  if (!count || !/^\d+(?:-\d+)?(?:\s*,\s*\d+(?:-\d+)?)*$/.test(value.trim())) return null;
  for (const entry of value.split(',')) {
    const [start, end] = entry.trim().split('-').map(Number);
    if (start === undefined || !Number.isSafeInteger(start) || start < 1) return null;
    const last = end ?? start;
    if (!Number.isSafeInteger(last) || last < start || last > count) return null;
    for (let page = start; page <= last; page++) selection.add(page);
  }
  return selection;
}

export function formatPageChoice(selection: Iterable<number>): string {
  const pages = [...new Set(selection)].sort((a, b) => a - b);
  if (!pages.length) return '';
  const runs: string[] = [];
  let start = pages[0]!, last = start;
  for (const page of pages.slice(1)) {
    if (page === last + 1) last = page;
    else { runs.push(start === last ? String(start) : `${start}-${last}`); start = last = page; }
  }
  runs.push(start === last ? String(start) : `${start}-${last}`);
  return runs.join(',');
}

export function mountWorkspace(container: HTMLDivElement, tool: ToolDefinition): void {
  mountRecoveredWorkspace(container, tool);
  if (tool.id !== 'remove-pages' && tool.id !== 'extract-pages') return;
  const removing = tool.id === 'remove-pages';
  const fileInput = container.querySelector<HTMLInputElement>('#workspace-file');
  const input = container.querySelector<HTMLInputElement>('#tool-options input[name="pages"]');
  const form = container.querySelector<HTMLFormElement>('#tool-options');
  const drop = container.querySelector<HTMLElement>('.drop-zone');
  const run = container.querySelector<HTMLButtonElement>('#run-operation');
  if (!fileInput || !input || !form || !drop || !run) return;
  const runtime = workspaceRuntime(container);
  const panel = document.createElement('section');
  panel.className = 'df-page-picker';
  panel.dataset.pagePickerReady = 'false';
  panel.dataset.pickerMode = tool.id;
  panel.hidden = true;
  panel.innerHTML = `
    <header class="df-picker-head"><div><span>${removing ? 'PAGES TO REMOVE' : 'PAGES TO EXTRACT'}</span><h2>${removing ? 'Select pages to remove' : 'Select pages to extract'}</h2><p>Choose pages below or type page numbers in Settings. The original PDF stays unchanged.</p></div><strong data-picker-count role="status" aria-live="polite">0 selected</strong></header>
    <div class="df-picker-actions"><button type="button" class="secondary" data-pick-all>Select all</button><button type="button" class="secondary" data-pick-clear>Clear selection</button><span>Tap to select · Shift-click for a range</span></div>
    <p data-picker-alert role="status" aria-live="polite" hidden></p>
    <div class="df-picker-grid" data-pick-grid role="group" aria-label="${removing ? 'Pages to remove' : 'Pages to extract'}"></div>
  `;
  form.prepend(panel);
  const count = panel.querySelector<HTMLElement>('[data-picker-count]')!;
  const alert = panel.querySelector<HTMLElement>('[data-picker-alert]')!;
  const grid = panel.querySelector<HTMLElement>('[data-pick-grid]')!;
  const dialog = document.createElement('dialog');
  dialog.className = 'df-picker-preview-dialog';
  dialog.setAttribute('aria-label', 'Page preview');
  dialog.innerHTML = `
    <header><h2 data-picker-preview-title>Preview page</h2><button type="button" class="secondary" data-picker-close aria-label="Close page preview">✕</button></header>
    <div class="df-picker-preview-canvas"><canvas role="img" aria-label="Enlarged page" data-picker-preview-canvas></canvas></div>
    <p role="status" data-picker-preview-status></p>
    <footer><button type="button" class="secondary" data-picker-preview-select>Select page</button><button type="button" class="primary" data-picker-close>Done</button></footer>
  `;
  const zoomCanvas = dialog.querySelector<HTMLCanvasElement>('[data-picker-preview-canvas]')!;
  const zoomStatus = dialog.querySelector<HTMLElement>('[data-picker-preview-status]')!;
  let selected = new Set<number>();
  let pages = 0;
  let anchor: number | null = null;
  let currentPreview: number | null = null;
  let previewTrigger: HTMLElement | null = null;
  let preview: PreviewController | null = null;
  let disposed = false, generation = 0, previewGeneration = 0, syncing = false;
  let observer: IntersectionObserver | null = null;
  const retained: HTMLCanvasElement[] = [];
  const showMessage = (text = ''): void => { alert.hidden = !text; alert.textContent = text; };

  const reflect = (): void => {
    count.textContent = `${selected.size} of ${pages} selected`;
    panel.dataset.selectedCount = String(selected.size);
    grid.querySelectorAll<HTMLElement>('[data-pick-page]').forEach(card => {
      const page = Number(card.dataset.pickPage);
      const active = selected.has(page);
      card.dataset.selected = String(active);
      const button = card.querySelector<HTMLButtonElement>('[data-pick-select]');
      if (button) { button.setAttribute('aria-pressed', String(active)); button.setAttribute('aria-label', `${active ? 'Deselect' : 'Select'} page ${page} ${removing ? 'for removal' : 'for extraction'}`); }
    });
    const modalSelect = dialog.querySelector<HTMLButtonElement>('[data-picker-preview-select]');
    if (modalSelect && currentPreview !== null) modalSelect.textContent = selected.has(currentPreview) ? 'Deselect page' : 'Select page';
    showMessage(removing && selected.size === pages && pages > 0 ? 'At least one page must remain. Deselect a page before processing.' : '');
    runtime.selection([...selected].sort((a, b) => a - b));
  };
  const emit = (): void => {
    syncing = true;
    input.value = formatPageChoice(selected);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    syncing = false;
    reflect();
  };
  const toggle = (number: number, range = false): void => {
    if (!Number.isInteger(number) || number < 1 || number > pages) return;
    if (range && anchor !== null) for (let p = Math.min(anchor, number); p <= Math.max(anchor, number); p++) selected.add(p);
    else { if (selected.has(number)) selected.delete(number); else selected.add(number); anchor = number; }
    emit();
  };
  const renderThumbnail = async (canvas: HTMLCanvasElement, active: PreviewController, ticket: number): Promise<void> => {
    if (canvas.dataset.renderState !== 'idle') return;
    canvas.dataset.renderState = 'busy';
    try {
      const success = await active.renderThumbnail(Number(canvas.dataset.sourcePage), canvas, .24);
      if (disposed || ticket !== generation || !canvas.isConnected) return;
      canvas.dataset.renderState = success ? 'complete' : 'idle';
      if (success) {
        retained.push(canvas);
        while (retained.length > 28) {
          const old = retained.shift()!;
          old.width = old.height = 1;
          old.dataset.renderState = 'idle';
        }
      }
    } catch { if (canvas.isConnected) canvas.dataset.renderState = 'error'; }
  };
  const render = (): void => {
    observer?.disconnect(); observer = null;
    const fragment = document.createDocumentFragment();
    for (let number = 1; number <= pages; number++) {
      const item = document.createElement('article');
      item.className = 'df-picker-card';
      item.dataset.pickPage = String(number);
      item.innerHTML = `
        <button type="button" class="df-picker-select" data-pick-select="${number}" aria-pressed="false" aria-label="Select page ${number}">
          <span class="df-picker-number">${number}</span>
          <canvas data-source-page="${number}" data-render-state="idle" aria-hidden="true"></canvas>
          <span class="df-picker-selected-mark" aria-hidden="true">${removing ? '×' : '✓'}</span>
          <strong>Page ${number}</strong>
        </button>
        <button type="button" class="df-picker-zoom" data-pick-preview="${number}" aria-label="Enlarge page ${number}">⤢ Preview</button>
      `;
      fragment.append(item);
    }
    grid.replaceChildren(fragment);
    reflect();
    const current = preview, ticket = generation;
    if (!current) return;
    const canvases = [...grid.querySelectorAll<HTMLCanvasElement>('canvas[data-source-page]')];
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(entries => entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const canvas = entry.target as HTMLCanvasElement;
        observer?.unobserve(canvas);
        void renderThumbnail(canvas, current, ticket);
      }), { root: grid, rootMargin: '160px' });
      canvases.forEach(canvas => observer?.observe(canvas));
    } else canvases.slice(0, 20).forEach(canvas => { void renderThumbnail(canvas, current, ticket); });
  };
  const clear = async (): Promise<void> => {
    const ticket = ++generation; ++previewGeneration;
    if (dialog.open) dialog.close();
    observer?.disconnect(); observer = null;
    retained.splice(0).forEach(canvas => { canvas.width = canvas.height = 1; });
    const previous = preview; preview = null;
    if (previous) await previous.destroy().catch(() => undefined);
    if (disposed || ticket !== generation) return;
    pages = 0; selected.clear(); anchor = null;
    panel.hidden = true; panel.dataset.pagePickerReady = 'false';
    grid.replaceChildren(); runtime.selection([]);
  };
  const load = async (file: File): Promise<void> => {
    const ticket = ++generation; ++previewGeneration;
    if (dialog.open) dialog.close();
    observer?.disconnect(); observer = null;
    retained.splice(0).forEach(canvas => { canvas.width = canvas.height = 1; });
    const previous = preview; preview = null;
    if (previous) await previous.destroy().catch(() => undefined);
    if (disposed || ticket !== generation) return;
    selected.clear(); pages = 0; anchor = null;
    panel.hidden = false; panel.dataset.pagePickerReady = 'false';
    grid.replaceChildren(); showMessage('Preparing page thumbnails…');
    try {
      const active = await createPreview(await file.arrayBuffer(), document.createElement('canvas'), document.createElement('span'));
      if (disposed || ticket !== generation) { await active.destroy(); return; }
      preview = active; pages = active.pageCount;
      const restored = parsePageChoice(input.value, pages);
      selected = restored ?? new Set<number>();
      panel.dataset.pagePickerReady = 'true';
      render();
      if (restored === null) showMessage('The typed page range is invalid for this document.');
    } catch (error) {
      if (disposed || ticket !== generation) return;
      showMessage(error instanceof Error ? `Unable to show thumbnails: ${error.message}` : 'Unable to show thumbnails. Type page numbers manually.');
    }
  };
  const onSource = (event: Event): void => {
    if (event.target !== fileInput) return;
    const file = [...(fileInput.files ?? [])][0];
    if (file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) void load(file);
    else void clear();
  };
  const onDrop = (event: DragEvent): void => {
    if (!(event.target instanceof Node) || !drop.contains(event.target)) return;
    const file = [...(event.dataTransfer?.files ?? [])][0];
    if (file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) void load(file);
  };
  const onRemove = (event: MouseEvent): void => {
    if (event.target instanceof Element && event.target.closest('[data-remove]')) void clear();
  };
  const onManual = (): void => {
    if (syncing || !pages) return;
    const parsed = parsePageChoice(input.value, pages);
    if (parsed === null) { showMessage('Invalid page range. Use 1,3-5 within this document.'); return; }
    selected = parsed; anchor = null; reflect();
  };
  const onGridClick = (event: MouseEvent): void => {
    const element = event.target instanceof Element ? event.target : null;
    const open = element?.closest<HTMLButtonElement>('[data-pick-preview]');
    if (open) {
      const number = Number(open.dataset.pickPreview);
      if (!preview || !number) return;
      const current = preview, ticket = ++previewGeneration;
      currentPreview = number; previewTrigger = open;
      dialog.querySelector<HTMLElement>('[data-picker-preview-title]')!.textContent = `Page ${number} of ${pages}`;
      zoomStatus.textContent = 'Rendering page…';
      const modalSelect = dialog.querySelector<HTMLButtonElement>('[data-picker-preview-select]')!;
      modalSelect.textContent = selected.has(number) ? 'Deselect page' : 'Select page';
      if (!dialog.isConnected) document.body.append(dialog);
      if (!dialog.open) dialog.showModal();
      void current.renderThumbnail(number, zoomCanvas, .76).then(ok => {
        if (!disposed && ticket === previewGeneration && dialog.open) zoomStatus.textContent = ok ? 'Source preview · original file unchanged' : 'Preview unavailable; page selection still works.';
      }).catch(() => { if (ticket === previewGeneration && dialog.open) zoomStatus.textContent = 'Preview unavailable; page selection still works.'; });
      return;
    }
    const select = element?.closest<HTMLButtonElement>('[data-pick-select]');
    if (select) toggle(Number(select.dataset.pickSelect), event.shiftKey);
  };
  const onPanelClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-pick-all]')) { selected = new Set(Array.from({length:pages},(_,i)=>i+1)); anchor=null; emit(); }
    if (target?.closest('[data-pick-clear]')) { selected.clear(); anchor=null; emit(); }
  };
  const onDialogClick = (event: MouseEvent): void => {
    const target = event.target as Element;
    if (target.closest('[data-picker-close]')) dialog.close();
    else if (target.closest('[data-picker-preview-select]') && currentPreview !== null) { toggle(currentPreview); dialog.close(); }
  };
  const onDialogClose = (): void => {
    ++previewGeneration;
    zoomCanvas.width = zoomCanvas.height = 1;
    const focus = previewTrigger;
    previewTrigger = null;
    if (focus?.isConnected) queueMicrotask(() => focus.focus({ preventScroll: true }));
  };
  const onRun = (event: MouseEvent): void => {
    if (!pages) return;
    const parsed = parsePageChoice(input.value, pages);
    const error = parsed === null ? 'Correct the page range.' : parsed.size === 0 ? 'Select at least one page.' : removing && parsed.size === pages ? 'Keep at least one page.' : '';
    if (!error) return;
    event.preventDefault(); event.stopImmediatePropagation();
    showMessage(error); panel.scrollIntoView({ block: 'nearest' });
  };
  const onPresented = (): void => {
    const centre = container.querySelector<HTMLElement>('.legacy-live-preview');
    if (centre) centre.prepend(panel);
  };
  document.addEventListener('docflow-workspace-presented', onPresented, { once: true });
  container.addEventListener('change', onSource, true);
  container.addEventListener('drop', onDrop, true);
  container.addEventListener('click', onRemove, true);
  input.addEventListener('input', onManual);
  grid.addEventListener('click', onGridClick);
  panel.addEventListener('click', onPanelClick);
  dialog.addEventListener('click', onDialogClick);
  dialog.addEventListener('close', onDialogClose);
  run.addEventListener('click', onRun, true);
  container.addEventListener('docflow-cleanup', () => {
    disposed = true; ++generation; ++previewGeneration;
    observer?.disconnect();
    const active = preview; preview = null;
    if (active) void active.destroy().catch(() => undefined);
    retained.splice(0).forEach(canvas => { canvas.width = canvas.height = 1; });
    if (dialog.open) dialog.close();
    dialog.remove();
    document.removeEventListener('docflow-workspace-presented', onPresented);
    container.removeEventListener('change', onSource, true);
    container.removeEventListener('drop', onDrop, true);
    container.removeEventListener('click', onRemove, true);
    input.removeEventListener('input', onManual);
    grid.removeEventListener('click', onGridClick);
    panel.removeEventListener('click', onPanelClick);
    dialog.removeEventListener('click', onDialogClick);
    dialog.removeEventListener('close', onDialogClose);
    run.removeEventListener('click', onRun, true);
  }, { once: true });
}
