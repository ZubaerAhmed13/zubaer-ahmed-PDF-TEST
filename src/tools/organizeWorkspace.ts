import '../styles/organize.css';
import type { ToolDefinition } from './registry';
import { mountWorkspace as mountRecoveredWorkspace } from './workspaceWithRecovery';
import { createPreview, type PreviewController } from '../pdf/render';

interface OrganizerItem {
  id: string;
  sourcePage: number;
}

function isPdf(file: File | null): file is File {
  return Boolean(file && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')));
}

function parseOrder(value: string, pageCount: number): number[] | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const pages = trimmed.split(',').map((part) => Number(part.trim()));
  if (!pages.length || pages.some((page) => !Number.isInteger(page) || page < 1 || page > pageCount)) return null;
  return pages;
}

export function mountWorkspace(container: HTMLDivElement, tool: ToolDefinition): void {
  mountRecoveredWorkspace(container, tool);

  const form = container.querySelector<HTMLFormElement>('#tool-options');
  const fileInput = container.querySelector<HTMLInputElement>('#workspace-file');
  const orderInput = form?.querySelector<HTMLInputElement>('input[name="order"]') ?? null;
  const dropZone = container.querySelector<HTMLElement>('.drop-zone');
  if (!form || !fileInput || !orderInput || !dropZone) return;

  const originalHelp = orderInput.closest('label')?.nextElementSibling;
  if (originalHelp instanceof HTMLElement) {
    originalHelp.textContent = 'Advanced deterministic order plan. The visual organizer below stays synchronized with this 1-based comma-separated page order.';
  }

  const panel = document.createElement('section');
  panel.className = 'organizer-panel';
  panel.dataset.organizerReady = 'false';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="organizer-toolbar" aria-label="Page organizer controls">
      <strong class="organizer-summary">Choose a PDF to build the organizer.</strong>
      <button type="button" class="secondary" data-organizer-action="select-all">Select all</button>
      <button type="button" class="secondary" data-organizer-action="clear-selection">Clear selection</button>
      <button type="button" class="secondary" data-organizer-action="duplicate-selected">Duplicate selected</button>
      <button type="button" class="secondary" data-organizer-action="delete-selected">Delete selected</button>
      <button type="button" class="secondary" data-organizer-action="undo" disabled>Undo</button>
      <button type="button" class="secondary" data-organizer-action="redo" disabled>Redo</button>
    </div>
    <div class="organizer-loading" data-organizer-status role="status" aria-live="polite">Choose a PDF to build page thumbnails.</div>
    <div class="organizer-grid" data-organizer-grid aria-label="PDF pages"></div>
  `;
  form.insertAdjacentElement('afterbegin', panel);

  const summary = panel.querySelector<HTMLElement>('.organizer-summary');
  const status = panel.querySelector<HTMLElement>('[data-organizer-status]');
  const grid = panel.querySelector<HTMLElement>('[data-organizer-grid]');
  const undoButton = panel.querySelector<HTMLButtonElement>('[data-organizer-action="undo"]');
  const redoButton = panel.querySelector<HTMLButtonElement>('[data-organizer-action="redo"]');
  const duplicateSelectedButton = panel.querySelector<HTMLButtonElement>('[data-organizer-action="duplicate-selected"]');
  const deleteSelectedButton = panel.querySelector<HTMLButtonElement>('[data-organizer-action="delete-selected"]');
  if (!summary || !status || !grid || !undoButton || !redoButton || !duplicateSelectedButton || !deleteSelectedButton) return;

  let sourceFile: File | null = null;
  let previewController: PreviewController | null = null;
  let observer: IntersectionObserver | null = null;
  let items: OrganizerItem[] = [];
  let sourcePageCount = 0;
  let loadGeneration = 0;
  let syncingOrder = false;
  let draggingId: string | null = null;
  const selectedIds = new Set<string>();
  const undoStack: number[][] = [];
  const redoStack: number[][] = [];
  let disposed = false;

  const orderValues = (): number[] => items.map((item) => item.sourcePage);

  const updateButtons = (): void => {
    undoButton.disabled = undoStack.length === 0;
    redoButton.disabled = redoStack.length === 0;
    duplicateSelectedButton.disabled = selectedIds.size === 0;
    deleteSelectedButton.disabled = selectedIds.size === 0;
  };

  const updateSummary = (): void => {
    summary.textContent = `${items.length} output page${items.length === 1 ? '' : 's'} from ${sourcePageCount} source page${sourcePageCount === 1 ? '' : 's'} · ${selectedIds.size} selected`;
    updateButtons();
  };

  const syncOrder = (): void => {
    syncingOrder = true;
    orderInput.value = orderValues().join(',');
    orderInput.dispatchEvent(new Event('input', { bubbles: true }));
    syncingOrder = false;
  };

  const pushUndo = (): void => {
    undoStack.push(orderValues());
    if (undoStack.length > 50) undoStack.shift();
    redoStack.length = 0;
  };

  const disconnectObserver = (): void => {
    observer?.disconnect();
    observer = null;
  };

  const renderVisibleThumbnail = async (canvas: HTMLCanvasElement, controller: PreviewController, generation: number): Promise<void> => {
    const pageNumber = Number(canvas.dataset.sourcePage);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) return;
    canvas.dataset.thumbnailState = 'rendering';
    try {
      const complete = await controller.renderThumbnail(pageNumber, canvas, 0.22);
      if (generation !== loadGeneration || !canvas.isConnected) return;
      canvas.dataset.thumbnailState = complete ? 'rendered' : 'idle';
    } catch {
      if (canvas.isConnected) canvas.dataset.thumbnailState = 'error';
    }
  };

  const observeThumbnails = (): void => {
    disconnectObserver();
    const controller = previewController;
    if (!controller) return;
    const generation = loadGeneration;
    const canvases = [...grid.querySelectorAll<HTMLCanvasElement>('canvas[data-source-page]')];
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || !(entry.target instanceof HTMLCanvasElement)) continue;
          observer?.unobserve(entry.target);
          void renderVisibleThumbnail(entry.target, controller, generation);
        }
      }, { root: grid, rootMargin: '180px' });
      canvases.forEach((canvas) => observer?.observe(canvas));
    } else {
      canvases.slice(0, 24).forEach((canvas) => { void renderVisibleThumbnail(canvas, controller, generation); });
    }
  };

  const renderGrid = (): void => {
    const fragment = document.createDocumentFragment();
    items.forEach((item, index) => {
      const card = document.createElement('article');
      card.className = 'organizer-card';
      card.draggable = true;
      card.dataset.itemId = item.id;
      card.dataset.sourcePage = String(item.sourcePage);
      card.dataset.selected = String(selectedIds.has(item.id));
      card.setAttribute('aria-label', `Output position ${index + 1}, source page ${item.sourcePage}`);
      card.innerHTML = `
        <div class="organizer-card-head">
          <label><input class="organizer-select" type="checkbox" data-select-item="${item.id}" ${selectedIds.has(item.id) ? 'checked' : ''}> Select</label>
          <strong>#${index + 1}</strong>
        </div>
        <canvas data-source-page="${item.sourcePage}" data-thumbnail-state="idle" aria-hidden="true"></canvas>
        <div><strong>Source page ${item.sourcePage}</strong></div>
        <div class="organizer-card-actions">
          <button type="button" class="secondary" data-card-action="left" aria-label="Move source page ${item.sourcePage} left" ${index === 0 ? 'disabled' : ''}>← Move</button>
          <button type="button" class="secondary" data-card-action="right" aria-label="Move source page ${item.sourcePage} right" ${index === items.length - 1 ? 'disabled' : ''}>Move →</button>
          <button type="button" class="secondary" data-card-action="duplicate" aria-label="Duplicate source page ${item.sourcePage}">Duplicate</button>
          <button type="button" class="secondary" data-card-action="remove" aria-label="Remove source page ${item.sourcePage}">Remove</button>
        </div>
      `;
      fragment.append(card);
    });
    grid.replaceChildren(fragment);
    panel.dataset.pageCount = String(sourcePageCount);
    updateSummary();
    observeThumbnails();
  };

  const restoreOrder = (order: number[]): void => {
    selectedIds.clear();
    items = order.map((sourcePage) => ({ id: crypto.randomUUID(), sourcePage }));
    syncOrder();
    renderGrid();
  };

  const clearOrganizer = async (): Promise<void> => {
    loadGeneration += 1;
    disconnectObserver();
    selectedIds.clear();
    items = [];
    sourcePageCount = 0;
    undoStack.length = 0;
    redoStack.length = 0;
    panel.dataset.organizerReady = 'false';
    panel.hidden = true;
    const controller = previewController;
    previewController = null;
    if (controller) await controller.destroy().catch(() => undefined);
  };

  const buildOrganizer = async (file: File): Promise<void> => {
    const generation = ++loadGeneration;
    disconnectObserver();
    const previous = previewController;
    previewController = null;
    if (previous) await previous.destroy().catch(() => undefined);
    if (disposed || generation !== loadGeneration) return;

    panel.hidden = false;
    panel.dataset.organizerReady = 'false';
    status.hidden = false;
    status.textContent = 'Loading page organizer…';
    grid.replaceChildren();

    try {
      const hiddenCanvas = document.createElement('canvas');
      const hiddenStatus = document.createElement('span');
      const controller = await createPreview(await file.arrayBuffer(), hiddenCanvas, hiddenStatus);
      if (disposed || generation !== loadGeneration) { await controller.destroy(); return; }
      previewController = controller;
      sourcePageCount = controller.pageCount;
      const restored = parseOrder(orderInput.value, sourcePageCount);
      items = (restored ?? Array.from({ length: sourcePageCount }, (_, index) => index + 1)).map((sourcePage) => ({ id: crypto.randomUUID(), sourcePage }));
      selectedIds.clear();
      undoStack.length = 0;
      redoStack.length = 0;
      syncOrder();
      status.hidden = true;
      panel.dataset.organizerReady = 'true';
      renderGrid();
    } catch (error) {
      if (disposed || generation !== loadGeneration) return;
      status.hidden = false;
      status.textContent = error instanceof Error ? `Could not build page organizer: ${error.message}` : 'Could not build page organizer.';
      panel.dataset.organizerReady = 'false';
    }
  };

  const captureFile = (files: FileList | File[]): void => {
    const file = [...files][0] ?? null;
    sourceFile = isPdf(file) ? file : null;
    if (sourceFile) void buildOrganizer(sourceFile);
    else void clearOrganizer();
  };

  const applyCardAction = (card: HTMLElement, action: string): void => {
    const index = items.findIndex((item) => item.id === card.dataset.itemId);
    if (index < 0) return;
    if (action === 'remove' && items.length === 1) {
      status.hidden = false;
      status.textContent = 'At least one output page must remain.';
      return;
    }
    if ((action === 'left' && index === 0) || (action === 'right' && index === items.length - 1)) return;
    pushUndo();
    if (action === 'left' || action === 'right') {
      const other = action === 'left' ? index - 1 : index + 1;
      [items[index], items[other]] = [items[other]!, items[index]!];
    } else if (action === 'duplicate') {
      const sourcePage = items[index]!.sourcePage;
      items.splice(index + 1, 0, { id: crypto.randomUUID(), sourcePage });
    } else if (action === 'remove') {
      selectedIds.delete(items[index]!.id);
      items.splice(index, 1);
    }
    status.hidden = true;
    syncOrder();
    renderGrid();
  };

  const onGridClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const actionButton = target?.closest<HTMLElement>('[data-card-action]');
    const card = target?.closest<HTMLElement>('.organizer-card');
    if (!actionButton || !card) return;
    applyCardAction(card, actionButton.dataset.cardAction ?? '');
  };

  const onGridChange = (event: Event): void => {
    const checkbox = event.target instanceof HTMLInputElement && event.target.matches('[data-select-item]') ? event.target : null;
    if (!checkbox?.dataset.selectItem) return;
    if (checkbox.checked) selectedIds.add(checkbox.dataset.selectItem);
    else selectedIds.delete(checkbox.dataset.selectItem);
    const card = checkbox.closest<HTMLElement>('.organizer-card');
    if (card) card.dataset.selected = String(checkbox.checked);
    updateSummary();
  };

  const onToolbarClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-organizer-action]') : null;
    const action = target?.dataset.organizerAction;
    if (!action) return;

    if (action === 'select-all') {
      items.forEach((item) => selectedIds.add(item.id));
      renderGrid();
      return;
    }
    if (action === 'clear-selection') {
      selectedIds.clear();
      renderGrid();
      return;
    }
    if (action === 'delete-selected') {
      if (!selectedIds.size) return;
      if (selectedIds.size >= items.length) {
        status.hidden = false;
        status.textContent = 'At least one output page must remain.';
        return;
      }
      pushUndo();
      items = items.filter((item) => !selectedIds.has(item.id));
      selectedIds.clear();
      status.hidden = true;
      syncOrder();
      renderGrid();
      return;
    }
    if (action === 'duplicate-selected') {
      if (!selectedIds.size) return;
      pushUndo();
      items = items.flatMap((item) => selectedIds.has(item.id)
        ? [item, { id: crypto.randomUUID(), sourcePage: item.sourcePage }]
        : [item]);
      selectedIds.clear();
      status.hidden = true;
      syncOrder();
      renderGrid();
      return;
    }
    if (action === 'undo' && undoStack.length) {
      const previous = undoStack.pop()!;
      redoStack.push(orderValues());
      restoreOrder(previous);
      return;
    }
    if (action === 'redo' && redoStack.length) {
      const next = redoStack.pop()!;
      undoStack.push(orderValues());
      restoreOrder(next);
    }
  };

  const onDragStart = (event: DragEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('button,input')) return;
    const card = target?.closest<HTMLElement>('.organizer-card');
    if (!card?.dataset.itemId) return;
    draggingId = card.dataset.itemId;
    event.dataTransfer?.setData('text/plain', draggingId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = (event: DragEvent): void => {
    if (!draggingId) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.organizer-card') : null;
    if (!target) return;
    event.preventDefault();
    grid.querySelectorAll('.drag-target').forEach((element) => element.classList.remove('drag-target'));
    target.classList.add('drag-target');
  };

  const onDrop = (event: DragEvent): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.organizer-card') : null;
    const sourceIndex = items.findIndex((item) => item.id === draggingId);
    const targetIndex = target ? items.findIndex((item) => item.id === target.dataset.itemId) : -1;
    grid.querySelectorAll('.drag-target').forEach((element) => element.classList.remove('drag-target'));
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) { draggingId = null; return; }
    event.preventDefault();
    pushUndo();
    const [moving] = items.splice(sourceIndex, 1);
    const insertionIndex = items.findIndex((item) => item.id === target!.dataset.itemId);
    items.splice(Math.max(0, insertionIndex), 0, moving!);
    draggingId = null;
    syncOrder();
    renderGrid();
  };

  const onDragEnd = (): void => {
    draggingId = null;
    grid.querySelectorAll('.drag-target').forEach((element) => element.classList.remove('drag-target'));
  };

  const onCaptureChange = (event: Event): void => {
    if (event.target === fileInput && fileInput.files) captureFile(fileInput.files);
  };

  const onCaptureDrop = (event: DragEvent): void => {
    if (!(event.target instanceof Node) || !dropZone.contains(event.target)) return;
    if (event.dataTransfer?.files) captureFile(event.dataTransfer.files);
  };

  const onCaptureRemove = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('[data-remove]')) return;
    sourceFile = null;
    void clearOrganizer();
  };

  const onRawOrderInput = (): void => {
    if (syncingOrder || !sourcePageCount) return;
    const parsed = parseOrder(orderInput.value, sourcePageCount);
    if (!parsed) return;
    selectedIds.clear();
    items = parsed.map((sourcePage) => ({ id: crypto.randomUUID(), sourcePage }));
    renderGrid();
  };

  grid.addEventListener('click', onGridClick);
  grid.addEventListener('change', onGridChange);
  grid.addEventListener('dragstart', onDragStart);
  grid.addEventListener('dragover', onDragOver);
  grid.addEventListener('drop', onDrop);
  grid.addEventListener('dragend', onDragEnd);
  panel.addEventListener('click', onToolbarClick);
  orderInput.addEventListener('input', onRawOrderInput);
  container.addEventListener('change', onCaptureChange, true);
  container.addEventListener('drop', onCaptureDrop, true);
  container.addEventListener('click', onCaptureRemove, true);

  container.addEventListener('docflow-cleanup', () => {
    disposed = true;
    loadGeneration += 1;
    disconnectObserver();
    const controller = previewController;
    previewController = null;
    if (controller) void controller.destroy().catch(() => undefined);
    grid.removeEventListener('click', onGridClick);
    grid.removeEventListener('change', onGridChange);
    grid.removeEventListener('dragstart', onDragStart);
    grid.removeEventListener('dragover', onDragOver);
    grid.removeEventListener('drop', onDrop);
    grid.removeEventListener('dragend', onDragEnd);
    panel.removeEventListener('click', onToolbarClick);
    orderInput.removeEventListener('input', onRawOrderInput);
    container.removeEventListener('change', onCaptureChange, true);
    container.removeEventListener('drop', onCaptureDrop, true);
    container.removeEventListener('click', onCaptureRemove, true);
  }, { once: true });
}
