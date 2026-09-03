import '../styles/preview.css';
import type { ToolDefinition } from './registry';
import { createPreview, type PreviewController } from '../pdf/render';
import { clearProjectSnapshot, loadProjectSnapshot, saveProjectSnapshot } from '../app/projectStore';

const THUMBNAIL_ROW_HEIGHT = 154;
const THUMBNAIL_OVERSCAN = 3;
const MIN_SCALE = 0.35;
const MAX_SCALE = 4;
const DEFAULT_SCALE = 1.25;

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

function isPdf(file: File | null): file is File {
  return Boolean(file && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')));
}

function clampScale(value: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));
}

export function mountWorkspace(container: HTMLDivElement, tool: ToolDefinition): void {
  container.innerHTML = `
    <div class="workspace-grid">
      <aside class="workspace-side">
        <p class="eyebrow">REVIEW</p>
        <h2>${escapeHtml(tool.name)}</h2>
        <p>${escapeHtml(tool.description)}</p>
        <div class="quality-box"><strong>Inspection</strong><span>Preview resolution never determines final structural PDF export quality.</span></div>
        <div class="privacy-box"><strong>Local processing</strong><span>PDF.js renders the selected document locally; no remote PDF-processing API is configured.</span></div>
      </aside>
      <section class="workspace-main">
        <div class="drop-zone" tabindex="0" role="button" aria-label="Choose files or drop files here">
          <strong>Drop a PDF here</strong><span>or choose from your device</span>
          <input id="workspace-file" type="file" accept=".pdf,application/pdf">
        </div>
        <div id="memory-warning" class="memory-warning" hidden></div>
        <div id="recovery-panel" class="notice" hidden></div>
        <div id="file-list" class="file-list" aria-live="polite"></div>
        <div id="preview-area"></div>
        <div class="operation-status" aria-live="polite">
          <div class="status-line"><span id="stage">Ready</span><span id="percent">0%</span></div>
          <progress id="progress" max="100" value="0"></progress>
          <div id="error" class="error-box" role="alert" hidden></div>
        </div>
        <div class="workspace-actions">
          <button class="secondary" id="cancel-operation" type="button" disabled>Cancel</button>
          <button class="primary" id="run-operation" type="button">Run ${escapeHtml(tool.name)}</button>
        </div>
      </section>
    </div>
  `;

  const input = container.querySelector<HTMLInputElement>('#workspace-file');
  const drop = container.querySelector<HTMLElement>('.drop-zone');
  const list = container.querySelector<HTMLElement>('#file-list');
  const warning = container.querySelector<HTMLElement>('#memory-warning');
  const recoveryPanel = container.querySelector<HTMLElement>('#recovery-panel');
  const previewArea = container.querySelector<HTMLElement>('#preview-area');
  const run = container.querySelector<HTMLButtonElement>('#run-operation');
  const cancel = container.querySelector<HTMLButtonElement>('#cancel-operation');
  const stage = container.querySelector<HTMLElement>('#stage');
  const percent = container.querySelector<HTMLElement>('#percent');
  const progress = container.querySelector<HTMLProgressElement>('#progress');
  const errorBox = container.querySelector<HTMLElement>('#error');
  if (!input || !drop || !list || !warning || !recoveryPanel || !previewArea || !run || !cancel || !stage || !percent || !progress || !errorBox) return;

  let file: File | null = null;
  let controller: PreviewController | null = null;
  let disposed = false;
  let generation = 0;
  let previewUiCleanup: (() => void) | null = null;

  const setError = (message = ''): void => {
    errorBox.hidden = !message;
    errorBox.textContent = message;
  };
  const setProgress = (message: string, value: number): void => {
    stage.textContent = message;
    progress.value = value;
    percent.textContent = `${Math.round(value)}%`;
  };
  const renderFile = (): void => {
    list.innerHTML = file ? `<div class="file-row"><span><strong>${escapeHtml(file.name)}</strong><small>${humanBytes(file.size)}</small></span><button type="button" data-remove aria-label="Remove ${escapeHtml(file.name)}">Remove</button></div>` : '';
    const memory = navigator as Navigator & { deviceMemory?: number };
    const risky = Boolean(file && (file.size > 250 * 1024 * 1024 || ((memory.deviceMemory ?? 8) <= 4 && file.size > 100 * 1024 * 1024)));
    warning.hidden = !risky;
    if (risky && file) warning.textContent = `Large input (${humanBytes(file.size)}). PDF.js still needs document buffers in browser memory. Preview is virtualized, but a memory-constrained browser may struggle with unusually large or complex files.`;
  };

  const persistMetadata = (): void => {
    if (!file) return;
    void saveProjectSnapshot({
      toolId: tool.id,
      files: [{ name: file.name, size: file.size, type: file.type, lastModified: file.lastModified }],
      options: {}
    }).catch(() => undefined);
  };

  const selectFile = (candidate: File | null): void => {
    if (candidate && !isPdf(candidate)) {
      setError('Choose a PDF file.');
      return;
    }
    setError();
    file = candidate;
    renderFile();
    if (file) persistMetadata();
  };

  input.addEventListener('change', () => {
    selectFile(input.files?.[0] ?? null);
    input.value = '';
  });
  drop.addEventListener('click', (event) => { if (event.target !== input) input.click(); });
  drop.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); }
  });
  for (const name of ['dragenter','dragover']) drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.add('dragging'); });
  for (const name of ['dragleave','drop']) drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.remove('dragging'); });
  drop.addEventListener('drop', (event) => selectFile(event.dataTransfer?.files?.[0] ?? null));
  list.addEventListener('click', (event) => {
    if (!(event.target as HTMLElement).closest('[data-remove]')) return;
    selectFile(null);
    previewUiCleanup?.();
    previewUiCleanup = null;
    const active = controller;
    controller = null;
    if (active) void active.destroy().catch(() => undefined);
    previewArea.replaceChildren();
    setProgress('Ready', 0);
  });

  recoveryPanel.addEventListener('click', (event) => {
    if (!(event.target as HTMLElement).closest('[data-clear-recovery]')) return;
    void clearProjectSnapshot().then(() => { if (!disposed) recoveryPanel.hidden = true; }).catch(() => undefined);
  });
  void loadProjectSnapshot().then((snapshot) => {
    if (disposed || file || !snapshot || snapshot.toolId !== tool.id || !snapshot.files.length) return;
    const saved = snapshot.files[0]!;
    recoveryPanel.innerHTML = `<strong>Recovered local project metadata</strong><p>${escapeHtml(saved.name)} · ${humanBytes(saved.size)}. The PDF itself was not stored; reselect it to continue.</p><button type="button" class="secondary" data-clear-recovery>Clear recovery</button>`;
    recoveryPanel.hidden = false;
  }).catch(() => undefined);

  const openPreview = async (): Promise<void> => {
    if (!file) { setError('Choose a PDF first.'); return; }
    const myGeneration = ++generation;
    setError();
    run.disabled = true;
    cancel.disabled = false;
    setProgress('Opening PDF', 8);

    previewUiCleanup?.();
    previewUiCleanup = null;
    const previous = controller;
    controller = null;
    if (previous) await previous.destroy().catch(() => undefined);
    if (disposed || myGeneration !== generation) return;

    previewArea.innerHTML = `
      <div class="viewer-toolbar" aria-label="PDF viewer controls">
        <button type="button" data-page="prev">Previous</button>
        <span id="viewer-status">Opening PDF…</span>
        <button type="button" data-page="next">Next</button>
        <span class="viewer-toolbar-divider" aria-hidden="true"></span>
        <button type="button" data-view="zoom-out" aria-label="Zoom out">−</button>
        <span id="zoom-level" aria-live="polite">125%</span>
        <button type="button" data-view="zoom-in" aria-label="Zoom in">+</button>
        <button type="button" data-view="actual">Actual size</button>
        <button type="button" data-view="fit-width">Fit width</button>
        <button type="button" data-view="fit-page">Fit page</button>
      </div>
      <div class="viewer-layout">
        <aside class="thumbnail-rail" aria-label="Page thumbnails"><div class="thumbnail-track"></div></aside>
        <div class="canvas-shell" tabindex="0" aria-label="PDF page viewer. Use left and right arrows for pages and plus or minus to zoom."><canvas id="pdf-canvas"></canvas></div>
      </div>
    `;

    const canvas = previewArea.querySelector<HTMLCanvasElement>('#pdf-canvas');
    const viewerStatus = previewArea.querySelector<HTMLElement>('#viewer-status');
    const zoomLevel = previewArea.querySelector<HTMLElement>('#zoom-level');
    const toolbar = previewArea.querySelector<HTMLElement>('.viewer-toolbar');
    const rail = previewArea.querySelector<HTMLElement>('.thumbnail-rail');
    const track = previewArea.querySelector<HTMLElement>('.thumbnail-track');
    const canvasShell = previewArea.querySelector<HTMLElement>('.canvas-shell');
    if (!canvas || !viewerStatus || !zoomLevel || !toolbar || !rail || !track || !canvasShell) return;

    try {
      const nextController = await createPreview(await file.arrayBuffer(), canvas, viewerStatus);
      if (disposed || myGeneration !== generation) { await nextController.destroy(); return; }
      controller = nextController;
      track.style.height = `${nextController.pageCount * THUMBNAIL_ROW_HEIGHT}px`;
      track.dataset.pageCount = String(nextController.pageCount);

      let current = 1;
      let currentScale = DEFAULT_SCALE;
      let fitMode: 'manual' | 'actual' | 'width' | 'page' = 'manual';
      let windowGeneration = 0;
      let renderFrame = 0;
      let wheelLocked = false;
      let pointerStartX: number | null = null;

      const updateZoom = (): void => { zoomLevel.textContent = `${Math.round(currentScale * 100)}%`; };
      const markCurrent = (): void => {
        track.querySelectorAll<HTMLElement>('.thumbnail-item[aria-current]').forEach((item) => item.removeAttribute('aria-current'));
        track.querySelector<HTMLElement>(`.thumbnail-item[data-thumbnail-page="${current}"]`)?.setAttribute('aria-current', 'page');
      };
      const renderThumbnailWindow = (): void => {
        renderFrame = 0;
        const localGeneration = ++windowGeneration;
        nextController.cancelThumbnails();
        const viewportHeight = Math.max(rail.clientHeight, THUMBNAIL_ROW_HEIGHT * 3);
        const firstVisible = Math.floor(rail.scrollTop / THUMBNAIL_ROW_HEIGHT) + 1;
        const start = Math.max(1, firstVisible - THUMBNAIL_OVERSCAN);
        const visibleRows = Math.ceil(viewportHeight / THUMBNAIL_ROW_HEIGHT) + THUMBNAIL_OVERSCAN * 2;
        const end = Math.min(nextController.pageCount, start + visibleRows - 1);
        const fragment = document.createDocumentFragment();
        for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'thumbnail-item';
          button.dataset.thumbnailPage = String(pageNumber);
          button.dataset.thumbnailState = 'idle';
          button.setAttribute('aria-label', `View page ${pageNumber}`);
          if (pageNumber === current) button.setAttribute('aria-current', 'page');
          button.style.top = `${(pageNumber - 1) * THUMBNAIL_ROW_HEIGHT + 4}px`;
          button.innerHTML = `<canvas aria-hidden="true"></canvas><span class="thumbnail-label">Page ${pageNumber}</span>`;
          fragment.append(button);
        }
        track.replaceChildren(fragment);
        const buttons = [...track.querySelectorAll<HTMLButtonElement>('.thumbnail-item')];
        void (async () => {
          for (const button of buttons) {
            if (localGeneration !== windowGeneration || controller !== nextController) return;
            const pageNumber = Number(button.dataset.thumbnailPage);
            const thumbnailCanvas = button.querySelector<HTMLCanvasElement>('canvas');
            if (!thumbnailCanvas) continue;
            button.dataset.thumbnailState = 'rendering';
            try {
              const completed = await nextController.renderThumbnail(pageNumber, thumbnailCanvas);
              if (localGeneration !== windowGeneration || !button.isConnected) return;
              button.dataset.thumbnailState = completed ? 'rendered' : 'idle';
            } catch {
              if (button.isConnected) button.dataset.thumbnailState = 'error';
            }
          }
        })();
      };
      const scheduleThumbnails = (): void => {
        if (renderFrame) cancelAnimationFrame(renderFrame);
        renderFrame = requestAnimationFrame(renderThumbnailWindow);
      };
      const ensureThumbnailVisible = (pageNumber: number): void => {
        const top = (pageNumber - 1) * THUMBNAIL_ROW_HEIGHT;
        const bottom = top + THUMBNAIL_ROW_HEIGHT;
        if (top < rail.scrollTop || bottom > rail.scrollTop + rail.clientHeight) {
          rail.scrollTop = Math.max(0, top - Math.max(0, (rail.clientHeight - THUMBNAIL_ROW_HEIGHT) / 2));
        }
      };
      const showPage = async (pageNumber: number, revealThumbnail = true): Promise<void> => {
        current = Math.max(1, Math.min(nextController.pageCount, pageNumber));
        if (revealThumbnail) ensureThumbnailVisible(current);
        scheduleThumbnails();
        setProgress(`Rendering page ${current} of ${nextController.pageCount}`, 65);
        await nextController.render(current, currentScale);
        markCurrent();
        updateZoom();
        setProgress('Preview ready', 100);
      };
      const setScale = async (value: number, mode: typeof fitMode = 'manual'): Promise<void> => {
        currentScale = clampScale(value);
        fitMode = mode;
        updateZoom();
        await showPage(current, false);
      };
      const fit = async (mode: 'width' | 'page'): Promise<void> => {
        const rect = canvas.getBoundingClientRect();
        const baseWidth = rect.width / currentScale;
        const baseHeight = rect.height / currentScale;
        if (!baseWidth || !baseHeight) return;
        const availableWidth = Math.max(180, canvasShell.clientWidth - 24);
        const availableHeight = Math.max(240, window.innerHeight - canvasShell.getBoundingClientRect().top - 28);
        const target = mode === 'width' ? availableWidth / baseWidth : Math.min(availableWidth / baseWidth, availableHeight / baseHeight);
        await setScale(target, mode);
      };

      const onRailScroll = (): void => scheduleThumbnails();
      const onRailClick = (event: Event): void => {
        const item = (event.target as HTMLElement).closest<HTMLElement>('[data-thumbnail-page]');
        if (item?.dataset.thumbnailPage) void showPage(Number(item.dataset.thumbnailPage), false);
      };
      const onToolbarClick = (event: Event): void => {
        const target = (event.target as HTMLElement).closest<HTMLElement>('button');
        const pageDirection = target?.dataset.page;
        const view = target?.dataset.view;
        if (pageDirection) void showPage(current + (pageDirection === 'next' ? 1 : -1));
        else if (view === 'zoom-in') void setScale(currentScale * 1.2);
        else if (view === 'zoom-out') void setScale(currentScale / 1.2);
        else if (view === 'actual') void setScale(1, 'actual');
        else if (view === 'fit-width') void fit('width');
        else if (view === 'fit-page') void fit('page');
      };
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); void showPage(current + 1); }
        else if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); void showPage(current - 1); }
        else if (event.key === 'Home') { event.preventDefault(); void showPage(1); }
        else if (event.key === 'End') { event.preventDefault(); void showPage(nextController.pageCount); }
        else if (event.key === '+' || event.key === '=') { event.preventDefault(); void setScale(currentScale * 1.2); }
        else if (event.key === '-') { event.preventDefault(); void setScale(currentScale / 1.2); }
        else if (event.key === '0') { event.preventDefault(); void setScale(1, 'actual'); }
      };
      const onWheel = (event: WheelEvent): void => {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          void setScale(currentScale * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
          return;
        }
        if (wheelLocked || Math.abs(event.deltaY) < 50) return;
        const atTop = canvasShell.scrollTop <= 1;
        const atBottom = canvasShell.scrollTop + canvasShell.clientHeight >= canvasShell.scrollHeight - 2;
        if (event.deltaY > 0 && atBottom && current < nextController.pageCount) {
          event.preventDefault(); wheelLocked = true; void showPage(current + 1).finally(() => { canvasShell.scrollTop = 0; window.setTimeout(() => { wheelLocked = false; }, 180); });
        } else if (event.deltaY < 0 && atTop && current > 1) {
          event.preventDefault(); wheelLocked = true; void showPage(current - 1).finally(() => { canvasShell.scrollTop = canvasShell.scrollHeight; window.setTimeout(() => { wheelLocked = false; }, 180); });
        }
      };
      const onPointerDown = (event: PointerEvent): void => {
        if (event.pointerType === 'touch' || event.pointerType === 'pen') pointerStartX = event.clientX;
      };
      const onPointerUp = (event: PointerEvent): void => {
        if (pointerStartX === null) return;
        const delta = event.clientX - pointerStartX;
        pointerStartX = null;
        if (Math.abs(delta) < 60) return;
        void showPage(current + (delta < 0 ? 1 : -1));
      };
      const onResize = (): void => {
        if (fitMode === 'width' || fitMode === 'page') void fit(fitMode);
      };

      rail.addEventListener('scroll', onRailScroll, { passive: true });
      rail.addEventListener('click', onRailClick);
      toolbar.addEventListener('click', onToolbarClick);
      canvasShell.addEventListener('keydown', onKeyDown);
      canvasShell.addEventListener('wheel', onWheel, { passive: false });
      canvasShell.addEventListener('pointerdown', onPointerDown);
      canvasShell.addEventListener('pointerup', onPointerUp);
      window.addEventListener('resize', onResize);
      previewUiCleanup = () => {
        windowGeneration += 1;
        if (renderFrame) cancelAnimationFrame(renderFrame);
        nextController.cancelThumbnails();
        rail.removeEventListener('scroll', onRailScroll);
        rail.removeEventListener('click', onRailClick);
        toolbar.removeEventListener('click', onToolbarClick);
        canvasShell.removeEventListener('keydown', onKeyDown);
        canvasShell.removeEventListener('wheel', onWheel);
        canvasShell.removeEventListener('pointerdown', onPointerDown);
        canvasShell.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('resize', onResize);
      };

      await showPage(1);
      if (disposed || myGeneration !== generation) return;
      setProgress('Preview ready', 100);
    } catch (error) {
      if (disposed || myGeneration !== generation) return;
      setError(error instanceof Error ? error.message : 'The PDF preview could not be opened.');
      setProgress('Failed', 0);
    } finally {
      if (!disposed && myGeneration === generation) {
        run.disabled = false;
        cancel.disabled = true;
      }
    }
  };

  run.addEventListener('click', () => { void openPreview(); });
  cancel.addEventListener('click', () => {
    generation += 1;
    previewUiCleanup?.();
    previewUiCleanup = null;
    const active = controller;
    controller = null;
    if (active) void active.destroy().catch(() => undefined);
    run.disabled = false;
    cancel.disabled = true;
    setProgress('Cancelled', 0);
    setError('Operation cancelled.');
  });

  const beforeUnload = (event: BeforeUnloadEvent): void => {
    if (!file && !controller) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', beforeUnload);

  container.addEventListener('docflow-cleanup', () => {
    disposed = true;
    generation += 1;
    previewUiCleanup?.();
    previewUiCleanup = null;
    const active = controller;
    controller = null;
    if (active) void active.destroy().catch(() => undefined);
    window.removeEventListener('beforeunload', beforeUnload);
  }, { once: true });
}
