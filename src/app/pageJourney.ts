import { tools, type ToolDefinition } from '../tools/registry';
import { PageResults, type PageOutput } from './pageResults';
import { parsePageRoute, pageRouteHash, type PageRoute } from './pageRoutes';
import { addShareButton } from './fileExport';
import type { OutputReady, OutputAction } from './exportReview';
import { preservationConsequences } from '../pdf/preservationPolicy';
import { isFavorite, subscribeFavorites, toggleFavorite } from './favoriteStore';

const sourceSelector = '#workspace-file,#pro-pdf,#wf-input,#batch-files';
const escape = (value: string): string => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
interface JourneyOptions {
  root: HTMLElement;
  dialog: HTMLDialogElement;
  workspace: HTMLElement;
  canLeave: () => Promise<boolean>;
  refresh: () => void;
  mount: (id: string, trigger?: HTMLElement | null, view?: File) => Promise<boolean>;
}

/** Route/presentation owner. It never runs a PDF transform or persists a document. */
export class PageJourney {
  private route: PageRoute = { kind: 'home' };
  private index = 0;
  private ticket = 0;
  private tool: ToolDefinition | null = null;
  private busy = false;
  private resultToken = '';
  private outputs = new PageResults();
  private urls: string[] = [];
  private sourceCount = 0;
  private sources: readonly File[] = [];
  private loadFailed = false;
  private configuring = false;
  private captureFailed = false;
  private hiddenHome = new Map<HTMLElement, boolean>();
  private popHash = '';
  private upload: HTMLElement;
  private result: HTMLElement;
  private bar: HTMLElement;

  constructor(private readonly options: JourneyOptions) {
    const { root, dialog, workspace } = options;
    dialog.classList.add('workspace-page');
    dialog.setAttribute('role', 'region'); dialog.removeAttribute('aria-modal');
    this.bar = document.createElement('div'); this.bar.className = 'page-toolbar';
    this.bar.innerHTML = `<button type="button" class="secondary" data-page-home aria-label="Back to all tools">← All tools</button><strong data-page-tool></strong><button type="button" class="secondary page-favorite" data-page-favorite aria-label="Pin tool" aria-pressed="false">☆</button><nav class="page-steps" aria-label="Task progress"><span data-step="upload">1 <b>Select file</b></span><span data-step="edit">2 <b>Work on PDF</b></span><span data-step="result">3 <b>Download</b></span></nav><details class="settings-menu page-support"><summary>Help</summary><div class="settings-menu-items"><button type="button" data-action="help">Find tools and help</button><button type="button" data-action="offline">Help & offline</button></div></details><p class="page-notice" data-page-notice role="alert"></p>`;
    this.upload = document.createElement('section'); this.upload.className = 'page-upload'; this.upload.dataset.uploadStage = '';
    this.upload.innerHTML = `<div class="upload-glyph" aria-hidden="true">↥</div><p class="eyebrow">Your document, your next step</p><h1 tabindex="-1"></h1><p data-upload-description></p><button type="button" class="primary" data-select-source disabled>Select PDF file</button><p class="upload-drop-hint">or drop your file here</p><p data-upload-formats></p><p class="processing-label"><span aria-hidden="true">●</span> Processed on your device</p><p class="upload-scope">Your original stays unchanged. Review the output before sharing.</p><button type="button" class="secondary" data-configure-workflow hidden>Manage workflow recipes</button><p data-upload-status role="status"></p>`;
    this.result = document.createElement('section'); this.result.className = 'page-result'; this.result.dataset.resultPage = ''; this.result.hidden = true;
    dialog.prepend(this.bar, this.upload); dialog.append(this.result);
    const mobileTools = document.createElement('div'); mobileTools.className = 'page-mobile-tools';
    mobileTools.innerHTML = '<button type="button" class="secondary" data-mobile-panel="files" aria-expanded="false">Pages & files</button><button type="button" class="secondary" data-mobile-panel="options" aria-expanded="false">Options</button>';
    this.bar.after(mobileTools);
    root.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[data-page-home]')) { event.preventDefault(); void this.home(); }
      if (target?.closest('[data-select-source]')) workspace.querySelector<HTMLInputElement>(sourceSelector)?.click();
      if (target?.closest('[data-return-editor]') && this.tool) void this.open(this.tool.id);
      if (target?.closest('[data-configure-workflow]')) { this.configuring = true; this.present('tool'); }
      if (target?.closest('[data-page-favorite]') && this.tool) toggleFavorite(this.tool.id);
      const panel = target?.closest<HTMLButtonElement>('[data-mobile-panel]');
      if (panel) {
        const selected = dialog.dataset.mobilePanel === panel.dataset.mobilePanel ? '' : panel.dataset.mobilePanel;
        dialog.dataset.mobilePanel = selected;
        mobileTools.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.setAttribute('aria-expanded', String(button.dataset.mobilePanel === selected)));
      }
    });
    this.upload.addEventListener('dragover', event => { event.preventDefault(); this.upload.classList.add('dragging'); });
    this.upload.addEventListener('dragleave', () => this.upload.classList.remove('dragging'));
    this.upload.addEventListener('drop', event => {
      event.preventDefault(); this.upload.classList.remove('dragging');
      const input = workspace.querySelector<HTMLInputElement>(sourceSelector);
      if (!input || this.busy || !event.dataTransfer?.files.length) return;
      const transfer = new DataTransfer();
      for (const file of [...event.dataTransfer.files].slice(0, input.multiple ? undefined : 1)) transfer.items.add(file);
      input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    workspace.addEventListener('docflow-output-ready', event => this.output((event as CustomEvent<OutputReady>).detail));
    subscribeFavorites(() => this.refreshFavorite());
    window.addEventListener('popstate', event => {
      this.popHash = location.hash;
      void this.navigate(parsePageRoute(location.hash, new Set(tools.map(t => t.id))), { position: event.state?.dfPageIndex });
    });
    window.addEventListener('hashchange', () => {
      if (this.popHash === location.hash) { this.popHash = ''; return; }
      if (location.hash === pageRouteHash(this.route)) return;
      void this.navigate(parsePageRoute(location.hash, new Set(tools.map(t => t.id))), { position: undefined });
    });
  }

  start(): void {
    history.replaceState({ ...history.state, dfPageIndex: 0 }, '', location.href);
    const desired = parsePageRoute(location.hash, new Set(tools.map(t => t.id)));
    if (desired.kind !== 'home') void this.navigate(desired, { position: 0 });
    else this.present('home');
  }

  open(id: string, trigger?: HTMLElement | null, view?: File, force = false): Promise<boolean> {
    return this.navigate({ kind: 'tool', toolId: id }, undefined, trigger, view, force);
  }
  home(): Promise<boolean> { return this.navigate({ kind: 'home' }); }
  closed(): void { if (this.route.kind !== 'home') void this.home(); }

  private async navigate(route: PageRoute, historyMove?: { position: unknown }, trigger?: HTMLElement | null, view?: File, force = false): Promise<boolean> {
    const ticket = ++this.ticket;
    const reuse = route.kind === 'tool' && route.toolId === this.tool?.id && this.options.dialog.open && !view && !force;
    const sameResult = route.kind === 'result' && Boolean(this.outputs.get(route.id));
    if (!reuse && !sameResult && !await this.options.canLeave()) {
      this.options.refresh();
      if (ticket === this.ticket && historyMove) this.restoreHistory();
      return false;
    }
    if (ticket !== this.ticket) return false;
    if (route.kind === 'tool') {
      const tool = tools.find(t => t.id === route.toolId); if (!tool) return false;
      if (!reuse) {
        this.tool = tool; this.sourceCount = 0; this.sources = []; this.busy = false; this.bar.dataset.busy = 'false'; this.loadFailed = false; this.configuring = false; this.invalidate();
        this.refreshFavorite();
        this.upload.querySelector<HTMLElement>('[data-configure-workflow]')!.hidden = tool.id !== 'workflow';
        this.upload.querySelector('h1')!.textContent = tool.name;
        this.upload.querySelector('[data-upload-description]')!.textContent = tool.description;
        this.upload.querySelector<HTMLButtonElement>('[data-select-source]')!.disabled = true;
        this.present('tool');
        if (!await this.options.mount(tool.id, trigger, view)) return false;
        if (ticket !== this.ticket) return false;
        const input = this.options.workspace.querySelector<HTMLInputElement>(sourceSelector);
        this.loadFailed = !input;
        const chooser = this.upload.querySelector<HTMLButtonElement>('[data-select-source]')!;
        chooser.disabled = !input;
        chooser.textContent = tool.id === 'images-to-pdf' ? 'Select images' : tool.multipleFiles ? 'Select PDF files' : 'Select PDF file';
        this.upload.querySelector('[data-upload-formats]')!.textContent = input ? (input.accept || 'PDF documents') + (input.multiple ? ' · multiple files supported' : ' · one file at a time') : '';
        this.upload.querySelector('[data-upload-status]')!.textContent = input ? '' : 'The tool could not load. Use Retry below.';
        if (!input) this.options.workspace.hidden = false;
      }
      this.present('tool');
      this.bar.querySelector('[data-page-tool]')!.textContent = tool.name;
    } else if (route.kind === 'home') {
      this.releaseURLs(); this.outputs.invalidate(); this.tool = null;
      if (this.options.dialog.open) this.options.dialog.close();
      this.present('home');
    } else {
      this.renderResult(route.kind === 'result' ? route.id : '');
      if (!this.options.dialog.open) this.options.dialog.show();
      this.present('result');
    }
    this.route = route;
    const hash = pageRouteHash(route);
    if (historyMove) {
      this.index = typeof historyMove.position === 'number' ? historyMove.position : this.index + 1;
      history.replaceState({ ...history.state, dfPageIndex: this.index }, '', hash);
    } else {
      this.index += 1;
      history.pushState({ dfPageIndex: this.index }, '', hash);
    }
    document.title = (route.kind === 'home' ? 'All PDF tools' : route.kind === 'tool' ? this.tool?.name ?? 'PDF tool' : 'Your result') + ' · DocFlow';
    queueMicrotask(() => {
      if (ticket !== this.ticket) return;
      const focus = route.kind === 'home' ? this.options.root.querySelector<HTMLElement>('#tool-search') : route.kind === 'tool' && !this.sourceCount ? this.upload.querySelector<HTMLElement>('[data-select-source]') : route.kind === 'result' || route.kind === 'missing' ? this.result.querySelector<HTMLElement>('h1') : this.bar.querySelector<HTMLElement>('[data-page-home]');
      focus?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    return true;
  }

  private restoreHistory(): void {
    const position = history.state?.dfPageIndex;
    if (typeof position === 'number' && position !== this.index) history.go(this.index - position);
    else history.replaceState({ ...history.state, dfPageIndex: this.index }, '', pageRouteHash(this.route));
  }

  inputs(files: readonly File[]): void {
    if (files.length === this.sources.length && files.every((file, index) => file === this.sources[index])) return;
    if (!this.sourceCount && files.length && matchMedia('(max-width:760px)').matches) {
      const inspector = this.options.workspace.querySelector<HTMLDetailsElement>('.direct-inspector');
      if (inspector) inspector.open = false;
    }
    this.sourceCount = files.length;
    this.sources = [...files];
    this.invalidate();
    if (this.options.root.dataset.page !== 'home') this.present('tool');
    if (this.route.kind === 'result' && this.tool) void this.open(this.tool.id);
  }
  processing(value: boolean): void {
    this.busy = value;
    this.bar.dataset.busy = String(value);
    if (value) { this.invalidate(); this.resultToken = this.outputs.start(this.tool?.id ?? ''); }
    else queueMicrotask(() => this.finish());
  }
  invalidate(): void {
    this.releaseURLs(); this.outputs.invalidate(); this.resultToken = ''; this.captureFailed = false;
    this.bar.querySelector('[data-page-notice]')!.textContent = '';
  }
  private output(detail: OutputReady): void {
    // Queue/draft redraws also rebuild old download links. Only a running export
    // may move the user to a new result page.
    if (!this.busy || !detail?.link.isConnected || detail.toolId !== this.tool?.id) return;
    if (!this.resultToken) this.resultToken = this.outputs.start(detail.toolId);
    try { this.outputs.add(this.resultToken, { blob: detail.blob, name: detail.link.download, source: detail.source, identity: detail.link, link: detail.link }); }
    catch (error) { this.captureFailed = true; this.bar.querySelector('[data-page-notice]')!.textContent = error instanceof Error ? error.message : String(error); return; }
    queueMicrotask(() => this.finish());
  }
  private finish(): void {
    if (this.busy || this.captureFailed || !this.outputs.get(this.resultToken)) return;
    if (this.route.kind === 'result' && this.route.id === this.resultToken) { this.renderResult(this.resultToken); return; }
    void this.navigate({ kind: 'result', id: this.resultToken });
  }

  private present(page: 'home' | 'tool' | 'result'): void {
    const { root, dialog, workspace } = this.options;
    root.dataset.page = page;
    for (const node of root.querySelectorAll<HTMLElement>('#main > section,.app-shell > footer')) {
      if (page !== 'home') { if (!this.hiddenHome.has(node)) this.hiddenHome.set(node, node.hidden); node.hidden = true; }
      else if (this.hiddenHome.has(node)) { node.hidden = node.matches('[data-document-home]') ? !node.childElementCount : this.hiddenHome.get(node)!; this.hiddenHome.delete(node); }
    }
    root.querySelector<HTMLElement>('.app-header')!.hidden = page !== 'home';
    this.upload.hidden = page !== 'tool' || this.sourceCount > 0 || this.configuring;
    workspace.hidden = page !== 'tool' || (this.sourceCount === 0 && !this.loadFailed && !this.configuring);
    this.result.hidden = page !== 'result';
    dialog.dataset.pageStage = page === 'result' ? 'result' : this.sourceCount ? 'edit' : 'upload';
    this.bar.querySelectorAll<HTMLElement>('[data-step]').forEach(step => {
      if (step.dataset.step === dialog.dataset.pageStage) step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current');
    });
    const toolbar = dialog.querySelector<HTMLElement>('[data-document-toolbar]');
    if (toolbar) toolbar.inert = page === 'home';
  }

  private renderResult(id: string): void {
    this.releaseURLs();
    const group = this.outputs.get(id);
    if (!group) {
      this.result.innerHTML = `<div class="result-symbol" aria-hidden="true">↺</div><h1 tabindex="-1">This result is no longer available</h1><p>Documents and results stay in this tab. Select your file again after a reload, or return to your current editor.</p><button type="button" class="primary" data-page-home>Choose a tool</button>${this.tool ? '<button type="button" class="secondary" data-return-editor>Return to editing</button>' : ''}`;
      return;
    }
    const status = this.options.workspace.querySelector('#stage,#wf-stage,#batch-stage,#pro-stage')?.textContent ?? '';
    this.result.innerHTML = `<div class="result-symbol success" aria-hidden="true">✓</div><p class="eyebrow">${escape(this.tool?.name ?? 'PDF operation')} · result</p><h1 tabindex="-1">Your ${group.outputs.length === 1 ? 'file is' : 'files are'} ready</h1><p>Review your result, then save a copy to your device.</p>${/cancel|failed|succeeded|Finished/i.test(status) ? '<p class="result-job-summary">' + escape(status) + '</p>' : ''}<div class="page-output-list"></div><div class="result-return"><button type="button" class="secondary" data-return-editor>Return to editing</button><button type="button" class="secondary" data-page-home>Choose another tool</button></div><p class="result-lifetime">This result stays in this tab until you change the source, edit again or close/reload. Your original file is unchanged.</p>`;
    const list = this.result.querySelector('.page-output-list')!;
    // Preserve the engine's actual recovery warnings when hiding its workspace.
    for (const warning of this.options.workspace.querySelectorAll<HTMLElement>('.pro-warning')) {
      if (!warning.textContent?.trim()) continue;
      const notice = document.createElement('p'); notice.className = 'page-result-warning';
      notice.textContent = warning.textContent; list.before(notice);
    }
    const report = this.options.workspace.querySelector<HTMLElement>('.info-result');
    if (report?.textContent?.trim()) {
      const details = document.createElement('details'); details.className = 'result-operation-details';
      const summary = document.createElement('summary'); summary.textContent = 'Operation details';
      const content = document.createElement('pre'); content.textContent = report.textContent;
      details.append(summary, content); list.before(details);
    }
    for (const output of group.outputs) this.renderOutput(list, output, group.toolId);
  }

  private renderOutput(list: Element, output: PageOutput, toolId: string): void {
    const card = document.createElement('article'); card.className = 'page-output';
    card.dataset.pageOutput = output.id;
    const pdf = output.blob.type === 'application/pdf';
    const url = URL.createObjectURL(output.blob); this.urls.push(url);
    card.innerHTML = `<label>Output filename<input type="text" value="${escape(output.name)}" maxlength="110" autocomplete="off"></label><p class="output-meta">${escape(output.blob.type || 'File')} · <strong>${output.blob.size.toLocaleString()} bytes</strong></p><div class="page-download-actions"><a class="primary" href="${url}" download="${escape(output.name)}">${pdf ? 'Download PDF' : output.blob.type.includes('zip') ? 'Download ZIP' : 'Download file'}</a></div><p class="output-status" role="status"></p>`;
    const link = card.querySelector('a')!;
    const input = card.querySelector('input')!;
    input.addEventListener('input', () => {
      this.outputs.rename(output.id, input.value); link.download = output.name; link.dispatchEvent(new Event('docflow-output-renamed'));
      const valid = new Set(this.outputs.get(this.resultToken)?.outputs.map(item => item.id));
      this.result.querySelectorAll<HTMLElement>('[data-page-output]').forEach(row => { if (!valid.has(row.dataset.pageOutput!)) row.remove(); });
    });
    input.addEventListener('change', () => { input.value = output.name; });
    addShareButton(link, output.blob);
    if (pdf) {
      const consequences = document.createElement('details'); consequences.className = 'result-consequences';
      const summary = document.createElement('summary'); summary.textContent = 'What changed in this PDF'; consequences.append(summary);
      for (const message of preservationConsequences(toolId)) { const p = document.createElement('p'); p.textContent = message; consequences.append(p); }
      card.append(consequences);
    }
    if (pdf && toolId !== 'protect-pdf') {
      const actions = document.createElement('div'); actions.className = 'page-result-actions';
      for (const [action, label] of [['review', 'Preview result'], ['continue', 'Continue with this result'], ...(output.source ? [['compare', 'Compare with original']] : [])] as [OutputAction['action'], string][]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = label;
        button.addEventListener('click', () => {
          this.options.workspace.dispatchEvent(new CustomEvent<OutputAction>('docflow-result-action', { detail: { action, file: new File([output.blob], output.name, { type: output.blob.type }), source: output.source, status: card.querySelector<HTMLElement>('.output-status')! } }));
        });
        actions.append(button);
      }
      card.append(actions);
    }
    list.append(card);
  }
  private releaseURLs(): void { this.urls.forEach(url => URL.revokeObjectURL(url)); this.urls = []; }
  private refreshFavorite(): void {
    const button = this.bar.querySelector<HTMLButtonElement>('[data-page-favorite]')!;
    const active = Boolean(this.tool && isFavorite(this.tool.id));
    button.disabled = !this.tool; button.textContent = active ? '★' : '☆';
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', (active ? 'Unpin ' : 'Pin ') + (this.tool?.name ?? 'tool'));
  }
}
