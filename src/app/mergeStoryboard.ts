import { createPreview } from '../pdf/render';
import '../styles/merge-storyboard.css';

export interface MergeSourceMeta { pageCount: number; }
export interface MergeStoryboardActions {
  move(from: number, to: number): void;
  remove(index: number): void;
  preview(index: number): void;
}

interface Storyboard {
  root: HTMLElement;
  panel: HTMLElement;
  cards: HTMLElement;
  files: File[];
  generation: number;
  pending: Promise<void>;
  observer: IntersectionObserver | null;
  rendered: HTMLCanvasElement[];
  drag: { from: number; pointerId: number; x: number; y: number; moved: boolean } | null;
  actions: MergeStoryboardActions;
  disposed: boolean;
}

const storyboards = new WeakMap<HTMLElement, Storyboard>();
const MAX_RETAINED_PREVIEWS = 24;

function bytes(size: number): string {
  return size < 1024 ? `${size} B` : `${(size / 1024 / (size >= 1024 * 1024 ? 1024 : 1)).toFixed(1)} ${size >= 1024 * 1024 ? 'MB' : 'KB'}`;
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
}
function isMerge(root: HTMLElement): boolean {
  return root.dataset.toolId === 'merge';
}

function queueRender(state: Storyboard, canvas: HTMLCanvasElement, file: File): void {
  if (canvas.dataset.storyboardRendered !== 'idle') return;
  canvas.dataset.storyboardRendered = 'queued';
  const ticket = state.generation;
  state.pending = state.pending.catch(() => {}).then(async () => {
    if (state.disposed || ticket !== state.generation || !canvas.isConnected) return;
    let active: Awaited<ReturnType<typeof createPreview>> | null = null;
    try {
      active = await createPreview(await file.arrayBuffer(), document.createElement('canvas'), document.createElement('span'));
      if (state.disposed || ticket !== state.generation || !canvas.isConnected) return;
      const ok = await active.renderThumbnail(1, canvas, .20);
      if (state.disposed || ticket !== state.generation || !canvas.isConnected) return;
      canvas.dataset.storyboardRendered = ok ? 'complete' : 'error';
      if (ok) {
        state.rendered.push(canvas);
        while (state.rendered.length > MAX_RETAINED_PREVIEWS) {
          const evicted = state.rendered.shift()!;
          if (!evicted.isConnected) continue;
          evicted.width = evicted.height = 1;
          evicted.dataset.storyboardRendered = 'idle';
          state.observer?.observe(evicted);
        }
      }
    } catch {
      if (ticket === state.generation && canvas.isConnected) canvas.dataset.storyboardRendered = 'error';
    } finally {
      await active?.destroy().catch(() => {});
    }
  });
}

function buildCards(state: Storyboard, files: File[], metadata: MergeSourceMeta[]): void {
  state.generation += 1;
  state.observer?.disconnect();
  state.observer = null;
  state.rendered.splice(0).forEach(c => { c.width = c.height = 1; });
  state.files = [...files];
  const total = metadata.reduce((sum, m) => sum + (m.pageCount || 0), 0);
  state.panel.querySelector<HTMLElement>('[data-storyboard-count]')!.textContent =
    `${files.length} PDF${files.length === 1 ? '' : 's'} · ${total > 0 ? total + ' pages' : 'preparing previews'}`;
  state.panel.hidden = files.length === 0;
  const fragment = document.createDocumentFragment();
  files.forEach((file, index) => {
    const card = document.createElement('article');
    card.className = 'df-merge-card';
    card.dataset.mergeCard = String(index);
    const count = metadata[index]?.pageCount;
    card.innerHTML = `
      <div class="df-merge-card-top">
        <span class="df-merge-sequence">${index + 1}</span>
        <span class="df-merge-drag-handle" data-storyboard-drag title="Drag to reorder. Use arrow buttons for keyboard." aria-hidden="true">⠿</span>
      </div>
      <div class="df-merge-card-picture">
        <canvas data-storyboard-canvas data-storyboard-rendered="idle" aria-hidden="true"></canvas>
        <span class="df-merge-pdf-fallback" aria-hidden="true">PDF</span>
      </div>
      <strong class="df-merge-card-name" title="${escapeHtml(file.name)}">PDF · ${escapeHtml(file.name)}</strong>
      <small class="df-merge-card-detail">${count ? count + (count === 1 ? ' page' : ' pages') : 'Reading pages…'} · ${bytes(file.size)}</small>
      <div class="df-merge-card-actions">
        <button type="button" data-storyboard-preview="${index}" aria-label="Inspect ${escapeHtml(file.name)}">Preview</button>
        <button type="button" data-storyboard-left="${index}" aria-label="Move ${escapeHtml(file.name)} left" ${index === 0 ? 'disabled' : ''}>←</button>
        <button type="button" data-storyboard-right="${index}" aria-label="Move ${escapeHtml(file.name)} right" ${index === files.length - 1 ? 'disabled' : ''}>→</button>
        <button type="button" data-storyboard-remove="${index}" aria-label="Remove ${escapeHtml(file.name)}">×</button>
      </div>
    `;
    fragment.append(card);
  });
  state.cards.replaceChildren(fragment);
  if (!files.length) return;
  const canvases = [...state.cards.querySelectorAll<HTMLCanvasElement>('[data-storyboard-canvas]')];
  if ('IntersectionObserver' in window) {
    state.observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        const canvas = entry.target as HTMLCanvasElement;
        state.observer?.unobserve(canvas);
        const index = Number(canvas.closest<HTMLElement>('[data-merge-card]')?.dataset.mergeCard ?? -1);
        const file = state.files[index];
        if (file) queueRender(state, canvas, file);
      }
    }, { root: state.cards, rootMargin: '160px' });
    canvases.forEach(c => state.observer?.observe(c));
  } else {
    canvases.slice(0, 12).forEach((canvas, index) => {
      const file = files[index];
      if (file) queueRender(state, canvas, file);
    });
  }
}

function install(root: HTMLElement, actions: MergeStoryboardActions): Storyboard | null {
  const center = root.querySelector<HTMLElement>('.legacy-live-preview');
  if (!center) return null;
  const panel = document.createElement('section');
  panel.className = 'df-merge-storyboard';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Merge PDF document order');
  panel.innerHTML = `
    <div class="df-merge-storyboard-header">
      <div><strong>Arrange your PDFs</strong><span>Drag the handle or use the arrows. First card is first in the result.</span></div>
      <span data-storyboard-count role="status" aria-live="polite">0 PDFs</span>
    </div>
    <div class="df-merge-storyboard-grid" data-storyboard-grid role="list" aria-label="PDF files in merge order"></div>
  `;
  center.prepend(panel);
  const cards = panel.querySelector<HTMLElement>('[data-storyboard-grid]')!;
  const state: Storyboard = { root, panel, cards, files: [], generation: 0, pending: Promise.resolve(), observer: null, rendered: [], drag: null, actions, disposed: false };
  panel.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const preview = target.closest<HTMLButtonElement>('[data-storyboard-preview]');
    const left = target.closest<HTMLButtonElement>('[data-storyboard-left]');
    const right = target.closest<HTMLButtonElement>('[data-storyboard-right]');
    const remove = target.closest<HTMLButtonElement>('[data-storyboard-remove]');
    if (preview) actions.preview(Number(preview.dataset.storyboardPreview));
    else if (left) actions.move(Number(left.dataset.storyboardLeft), Number(left.dataset.storyboardLeft) - 1);
    else if (right) actions.move(Number(right.dataset.storyboardRight), Number(right.dataset.storyboardRight) + 1);
    else if (remove) actions.remove(Number(remove.dataset.storyboardRemove));
  });
  // A small pointer-based drag interaction is more deterministic than native
  // HTML drag/drop in nested, scrollable PDF cards (especially Chromium and touch).
  // It changes only the actual source index via the existing worker reorder action.
  const clearDrag = (): void => {
    state.drag = null;
    cards.querySelectorAll('.df-merge-drop-target').forEach(el => el.classList.remove('df-merge-drop-target'));
    cards.classList.remove('df-merge-is-dragging');
  };
  const cardAtPoint = (x: number, y: number): HTMLElement | null => {
    const underPointer = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-merge-card]');
    if (underPointer && cards.contains(underPointer)) return underPointer;
    // elementFromPoint may hit an overlay during a touch or animated redraw.
    return [...cards.querySelectorAll<HTMLElement>('[data-merge-card]')].find(card => {
      const box = card.getBoundingClientRect();
      return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
    }) ?? null;
  };
  const pointerDown = (event: PointerEvent): void => {
    const handle = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-storyboard-drag]') : null;
    if (!handle || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const card = handle.closest<HTMLElement>('[data-merge-card]');
    const from = Number(card?.dataset.mergeCard);
    if (!card || !Number.isInteger(from) || from < 0) return;
    state.drag = { from, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    event.preventDefault();
  };
  const pointerMove = (event: PointerEvent): void => {
    const drag = state.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 8) return;
    drag.moved = true;
    cards.classList.add('df-merge-is-dragging');
    const target = cardAtPoint(event.clientX, event.clientY);
    cards.querySelectorAll('.df-merge-drop-target').forEach(el => el.classList.remove('df-merge-drop-target'));
    if (target && Number(target.dataset.mergeCard) !== drag.from) target.classList.add('df-merge-drop-target');
  };
  const pointerUp = (event: PointerEvent): void => {
    const drag = state.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const target = drag.moved ? cardAtPoint(event.clientX, event.clientY) : null;
    const to = target ? Number(target.dataset.mergeCard) : null;
    clearDrag();
    if (to !== null && Number.isInteger(to) && to !== drag.from) state.actions.move(drag.from, to);
  };
  const pointerCancel = (event: PointerEvent): void => {
    if (state.drag?.pointerId === event.pointerId) clearDrag();
  };
  cards.addEventListener('pointerdown', pointerDown);
  window.addEventListener('pointermove', pointerMove);
  window.addEventListener('pointerup', pointerUp);
  window.addEventListener('pointercancel', pointerCancel);
  // Prevent browser-native image/text dragging from stealing pointer events.
  cards.addEventListener('dragstart', event => event.preventDefault());
  root.addEventListener('docflow-cleanup', () => {
    clearDrag();
    cards.removeEventListener('pointerdown', pointerDown);
    window.removeEventListener('pointermove', pointerMove);
    window.removeEventListener('pointerup', pointerUp);
    window.removeEventListener('pointercancel', pointerCancel);
    state.disposed = true; state.generation++;
    state.observer?.disconnect(); state.observer = null;
    state.rendered.splice(0).forEach(canvas => { canvas.width = canvas.height = 1; });
    panel.remove();
    storyboards.delete(root);
  }, { once: true });
  storyboards.set(root, state);
  return state;
}

export function syncMergeStoryboard(root: HTMLElement, files: File[], meta: MergeSourceMeta[], actions: MergeStoryboardActions): void {
  if (!isMerge(root)) return;
  const state = storyboards.get(root) ?? install(root, actions);
  if (!state || state.disposed) return;
  state.actions = actions;
  const same = state.files.length === files.length && state.files.every((f, i) => f === files[i]);
  if (!same) buildCards(state, files, meta);
  else {
    const total = meta.reduce((sum, m) => sum + (m.pageCount || 0), 0);
    state.panel.querySelector<HTMLElement>('[data-storyboard-count]')!.textContent =
      `${files.length} PDF${files.length === 1 ? '' : 's'} · ${total > 0 ? total + ' pages' : 'preparing previews'}`;
    state.cards.querySelectorAll<HTMLElement>('[data-merge-card]').forEach((card, i) => {
      const count = meta[i]?.pageCount;
      const small = card.querySelector<HTMLElement>('.df-merge-card-detail');
      if (small && files[i]) small.textContent = `${count ? count + (count === 1 ? ' page' : ' pages') : 'Reading pages…'} · ${bytes(files[i]!.size)}`;
    });
  }
}
