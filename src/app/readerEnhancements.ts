import { TextLayer, type PDFPageProxy } from 'pdfjs-dist';
import type { PreviewController } from '../pdf/render';
import '../styles/reader-enhancements.css';

export interface PageRenderedDetail { page: PDFPageProxy; viewport: ReturnType<PDFPageProxy['getViewport']>; pageNumber: number; canvas: HTMLCanvasElement }
export function mountReaderEnhancements(host: HTMLElement, canvas: HTMLCanvasElement, controller: PreviewController, showPage: (page: number) => Promise<void>): () => void {
  const events = new AbortController(), signal = events.signal, doc = controller.document;
  const wrap = document.createElement('div'); wrap.className = 'reader-page'; canvas.before(wrap); wrap.append(canvas);
  const controls = document.createElement('section'); controls.className = 'reader-controls'; controls.setAttribute('aria-label','Reading tools');
  controls.innerHTML = `<label>Jump to page<input data-reader-page type="number" min="1" max="${controller.pageCount}" value="1"></label><form data-search-form><label>Search document<input data-reader-search type="search" maxlength="200"></label><button>Find</button><button type="button" data-find-prev>Previous match</button><button type="button" data-find-next>Next match</button></form><p data-find-status role="status" aria-live="polite"></p><button data-text-toggle>Accessible text view</button><label>Reading mode<select data-reader-mode><option value="single">Single page</option><option value="continuous">Continuous page group</option></select></label><details><summary>Document outline</summary><nav data-outline aria-label="Document bookmarks"></nav></details><div data-reader-text role="region" aria-label="Selectable page text" tabindex="0" hidden></div>`;
  host.querySelector('.viewer-toolbar')!.after(controls);
  const query = <T extends HTMLElement>(s: string): T => controls.querySelector<T>(s)!;
  let textLayer: TextLayer | null = null, disposed = false, generation = 0, searchGeneration = 0, current = 1;
  let hits: { page: number; start: number; end: number }[] = [], active = -1;
  const tasks = new Set<ReturnType<PDFPageProxy['render']>>();
  const notice = (s: string): void => { query('[data-find-status]').textContent = s; };
  async function destination(dest: unknown): Promise<number | null> {
    try { const array: unknown = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
      if (!Array.isArray(array) || !array.length) return null; const ref = array[0];
      return typeof ref === 'number' ? ref + 1 : await doc.getPageIndex(ref as Parameters<typeof doc.getPageIndex>[0]) + 1;
    } catch { return null; }
  }
  function highlight(): void {
    const spans = wrap.querySelectorAll<HTMLElement>('.reader-text-layer span[role=presentation]');
    let offset = 0;
    for (const span of spans) { const value = span.dataset.sourceText ?? span.textContent ?? ''; span.dataset.sourceText = value; span.replaceChildren(document.createTextNode(value));
      const hit = hits[active]; const start = hit?.page === current ? Math.max(0, hit.start - offset) : -1, end = hit?.page === current ? Math.min(value.length, hit.end - offset) : -1;
      if (start >= 0 && end > start) { const mark = document.createElement('mark'); mark.textContent = value.slice(start,end); span.replaceChildren(document.createTextNode(value.slice(0,start)), mark, document.createTextNode(value.slice(end))); }
      offset += value.length + 1;
    }
  }
  async function renderExtras(detail: PageRenderedDetail): Promise<void> {
    const ticket = ++generation; current = detail.pageNumber; query<HTMLInputElement>('[data-reader-page]').value = String(current);
    textLayer?.cancel(); wrap.querySelectorAll('.reader-text-layer,.reader-links').forEach(e => e.remove()); host.querySelectorAll('.reader-adjacent').forEach(e => e.remove()); tasks.forEach(t => t.cancel()); tasks.clear();
    const { page, viewport } = detail; wrap.style.width = `${viewport.width}px`; wrap.style.height = `${viewport.height}px`;
    try {
      const text = await page.getTextContent(); if (disposed || ticket !== generation) return;
      query('[data-reader-text]').textContent = text.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('');
      const layer = document.createElement('div'); layer.className = 'reader-text-layer'; layer.style.setProperty('--scale-factor', String(viewport.scale)); wrap.append(layer);
      textLayer = new TextLayer({ textContentSource: text, container: layer, viewport }); await textLayer.render(); if (disposed || ticket !== generation) return; highlight();
      const links = document.createElement('div'); links.className = 'reader-links'; wrap.append(links);
      for (const annotation of await page.getAnnotations({ intent: 'display' })) {
        if (disposed || ticket !== generation) return;
        if (!annotation.rect || (!annotation.url && !annotation.dest && annotation.subtype !== 'Text')) continue;
        const r = viewport.convertToViewportRectangle(annotation.rect), x = Math.min(r[0],r[2]), y = Math.min(r[1],r[3]);
        const link = document.createElement('a'); link.style.cssText = `left:${x}px;top:${y}px;width:${Math.abs(r[2]-r[0])}px;height:${Math.abs(r[3]-r[1])}px`;
        if (annotation.subtype === 'Text') { const note = String(annotation.contentsObj?.str ?? annotation.contents ?? 'Comment'); link.textContent = '▣'; link.title = note; link.href = '#'; link.setAttribute('aria-label','Comment: ' + note); link.addEventListener('click', e => { e.preventDefault(); query('[data-reader-text]').hidden = false; query('[data-reader-text]').textContent = note; }); }
        else if (annotation.url) { try { const url = new URL(annotation.url); if (!['https:','http:','mailto:'].includes(url.protocol)) continue; link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.setAttribute('aria-label','Open link: ' + url.href); } catch { continue; } }
        else { link.href = '#'; link.setAttribute('aria-label','Go to linked page'); link.addEventListener('click', e => { e.preventDefault(); void destination(annotation.dest).then(p => { if (p) void showPage(p); }); }); }
        links.append(link);
      }
      if (query<HTMLSelectElement>('[data-reader-mode]').value === 'continuous') {
        for (const number of [current - 1, current + 1]) {
          if (number < 1 || number > controller.pageCount || disposed || ticket !== generation) continue;
          const adjacent = await doc.getPage(number); if (disposed || ticket !== generation) return;
          const view = adjacent.getViewport({ scale: viewport.scale }); const section = document.createElement('section'); section.className = 'reader-adjacent';
          const button = document.createElement('button'); button.textContent = `Read page ${number}`; button.addEventListener('click', () => { void showPage(number); }); const c = document.createElement('canvas'); c.width = Math.ceil(view.width); c.height = Math.ceil(view.height); c.style.width = `${view.width}px`; c.style.height = `${view.height}px`; c.setAttribute('aria-label',`Page ${number} preview`); section.append(button,c);
          if (number < current) wrap.before(section); else wrap.after(section);
          const context = c.getContext('2d'); if (context) { const task = adjacent.render({ canvasContext: context, viewport: view }); tasks.add(task); try { await task.promise; } catch (e) { if (!(e instanceof Error) || e.name !== 'RenderingCancelledException') throw e; } finally { tasks.delete(task); } }
        }
      }
    } catch (e) { if (!disposed && ticket === generation && (!(e instanceof Error) || e.name !== 'AbortException')) notice('Some reading features could not be loaded. The page image is still available.'); }
  }
  canvas.addEventListener('docflow-page-rendered', e => { void renderExtras((e as CustomEvent<PageRenderedDetail>).detail); }, { signal });
  query('[data-reader-page]').addEventListener('change', () => { const value = Number(query<HTMLInputElement>('[data-reader-page]').value); if (Number.isInteger(value) && value >= 1 && value <= controller.pageCount) void showPage(value); }, { signal });
  const goHit = async (direction: number): Promise<void> => { if (!hits.length) return; active = (active + direction + hits.length) % hits.length; const hit = hits[active]!; notice(`Match ${active + 1} of ${hits.length} · page ${hit.page}`); if (current !== hit.page) await showPage(hit.page); else highlight(); };
  query('[data-find-next]').addEventListener('click', () => { void goHit(1); }, { signal }); query('[data-find-prev]').addEventListener('click', () => { void goHit(-1); }, { signal });
  query('[data-search-form]').addEventListener('submit', e => { e.preventDefault(); void (async () => { const ticket = ++searchGeneration, term = query<HTMLInputElement>('[data-reader-search]').value.toLocaleLowerCase(); hits = []; active = -1; highlight(); if (!term.trim()) { notice('Enter text to search. Scanned pages need OCR first.'); return; } notice('Searching selectable text…');
    try { for (let number = 1; number <= controller.pageCount; number++) { if (disposed || ticket !== searchGeneration) return; const page = await doc.getPage(number), content = await page.getTextContent(); const value = content.items.map(item => 'str' in item ? item.str : '').join(' ').toLocaleLowerCase(); let offset = 0; while ((offset = value.indexOf(term,offset)) !== -1) { hits.push({ page:number,start:offset,end:offset+term.length }); offset += Math.max(1,term.length); if (hits.length >= 5000) break; } if (hits.length >= 5000) break; if (number % 10 === 0) { notice(`Searching page ${number} of ${controller.pageCount}…`); await new Promise(resolve => setTimeout(resolve,0)); } } if (disposed || ticket !== searchGeneration) return; if (hits.length) await goHit(1); else notice('No matches in selectable text. Scanned pages need OCR first.'); } catch { if (!disposed && ticket === searchGeneration) notice('Search could not finish. Try another PDF or OCR scanned pages.'); }
  })(); }, { signal });
  query('[data-text-toggle]').addEventListener('click', () => { const text = query('[data-reader-text]'); text.hidden = !text.hidden; if (!text.hidden) text.focus(); }, { signal });
  query('[data-reader-mode]').addEventListener('change', () => { notice(query<HTMLSelectElement>('[data-reader-mode]').value === 'continuous' ? 'Continuous mode renders the current page and its neighbors. Select Read page to move the window; at most three pages stay rendered.' : 'Single page mode.'); void showPage(current); }, { signal });
  void doc.getOutline().then(outline => { if (disposed) return; const nav = query('[data-outline]'); if (!outline?.length) { nav.textContent = 'This PDF has no bookmarks.'; return; } let count = 0; const add = (items: NonNullable<typeof outline>, parent: HTMLElement, depth: number): void => { if (depth > 20) return; for (const item of items) { if (++count > 2000) return; const b = document.createElement('button'); b.textContent = item.title; b.style.marginLeft = `${depth * 12}px`; b.addEventListener('click', () => { void destination(item.dest).then(p => { if (p) void showPage(p); }); }); parent.append(b); add(item.items,parent,depth + 1); } }; add(outline,nav,0); }).catch(() => { if (!disposed) query('[data-outline]').textContent = 'Bookmarks unavailable.'; });
  return () => { disposed = true; generation++; searchGeneration++; events.abort(); textLayer?.cancel(); tasks.forEach(t => t.cancel()); controls.remove(); host.querySelectorAll('.reader-adjacent').forEach(e => e.remove()); if (wrap.isConnected) { wrap.before(canvas); wrap.remove(); } };
}
