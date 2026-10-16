import { tools, type ToolDefinition } from '../tools/registry';
import { DocumentSession, pdfFilename, validateSessionPdf } from './documentSession';
import { connectWorkspace } from './workspaceRuntime';
import { configureWorkProtection, confirmAction } from './workProtection';

const sourceSelector = '#workspace-file,#pro-pdf,#wf-input,#batch-files';
const pdfInput = (file: File): boolean => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
const escape = (text: string): string => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const icons = {
  undo: '<path d="M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12"/>',
  redo: '<path d="m15 5 5 5-5 5m5-5h-9a6 6 0 0 0 0 12"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>'
};
const icon = (name: keyof typeof icons): string => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;

export interface DocumentWorkspaceOptions {
  root: HTMLDivElement;
  dialog: HTMLDialogElement;
  toolbar: HTMLElement;
  home: HTMLElement;
  open: (id: string, view?: File) => Promise<void>;
}

/** One lifecycle owner above the existing tools; never observes their DOM. */
export class DocumentWorkspace {
  readonly session = new DocumentSession();
  private enabled = false;
  private tool: ToolDefinition | null = null;
  private files: File[] = [];
  private operation = false;
  private applying = false;
  private draft = false;
  private seeded = false;
  private allowedLeave = false;
  private viewing: File | null = null;
  private ticket: { baseId: string; sourceIds: string[] } | null = null;
  private disconnect: (() => void) | null = null;
  private bindings: AbortController | null = null;
  private urls: string[] = [];
  private filename = '';
  private notice = '';

  constructor(private readonly options: DocumentWorkspaceOptions) {
    this.session.subscribe(() => this.render());
    options.toolbar.addEventListener('click', event => { void this.click(event); });
    options.toolbar.addEventListener('change', event => {
      const target = event.target;
      if (target instanceof HTMLSelectElement && target.matches('[data-session-tool]')) {
        void options.open(target.value);
      }
      if (target instanceof HTMLSelectElement && target.matches('[data-session-output]')) this.render();
    });
    options.toolbar.addEventListener('input', event => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.matches('[data-session-name]')) {
        this.filename = target.value;
        const link = options.toolbar.querySelector<HTMLAnchorElement>('[data-session-action="export"]');
        if (link) link.download = pdfFilename(this.filename);
      }
    });
    options.home.addEventListener('click', event => {
      const target = (event.target as Element).closest<HTMLElement>('[data-session-resume]');
      if (target) void options.open('preview');
    });
    configureWorkProtection(
      () => ({ busy: this.busy, hasWork: Boolean(this.session.snapshot().current || this.files.length || this.draft) }),
      () => { this.unmount(); options.root.dispatchEvent(new CustomEvent('docflow-cleanup')); this.session.clear(); this.files = []; this.draft = false; }
    );
    window.addEventListener('beforeunload', event => {
      if (!this.session.snapshot().current && !this.busy) return;
      event.preventDefault(); event.returnValue = '';
    });
    this.render();
  }

  refresh(): void { this.render(); }

  get busy(): boolean { return this.operation || this.applying; }

  async begin(): Promise<void> {
    if (this.session.snapshot().current) { await this.options.open('preview'); return; }
    this.enabled = true;
    await this.options.open('preview');
  }

  async canLeave(): Promise<boolean> {
    // Applying a validated revision is an atomic commit, rather than a cancellable tool run.
    if (this.applying) {
      this.notice = 'Checking the PDF result. Please wait before leaving.';
      this.render();
      return false;
    }
    if (this.allowedLeave) return true;
    if (this.busy) {
      const approved = await confirmAction('Stop processing?', 'The unfinished operation will be cancelled. Your current document revision will stay in this tab.', 'Stop and leave');
      this.allowedLeave = approved;
      return approved;
    }
    if (this.enabled && this.draft) {
      const approved = await confirmAction('Leave unapplied tool changes?', 'The current document and applied history stay in this tab. Settings, selections or marks not yet run in this tool will be discarded.', 'Leave tool');
      if (approved) this.draft = false;
      return approved;
    }
    return true;
  }

  prepare(tool: ToolDefinition, viewing?: File): void {
    this.unmount();
    this.tool = tool; this.files = []; this.draft = false;
    this.viewing = viewing ?? null; this.ticket = null;
    const signal = (this.bindings = new AbortController()).signal;
    const { root } = this.options;
    this.disconnect = connectWorkspace(root, {
      sessionActive: () => this.enabled,
      inputs: files => {
        const seededFile = this.viewing ?? this.session.snapshot().current?.file;
        if (this.seeded && seededFile && files[0]) this.session.aliasSource(files[0], seededFile);
        const changed = files.length !== this.files.length || files.some((file, index) => this.session.sourceId(file) !== (this.files[index] ? this.session.sourceId(this.files[index]!) : ''));
        if (changed && !this.seeded && this.enabled && this.session.snapshot().current && this.tool?.id !== 'preview') this.draft = true;
        this.files = [...files];
        this.render();
      },
      busy: value => {
        this.operation = value;
        if (value) {
          const current = this.session.snapshot().current;
          this.ticket = current ? { baseId: current.id, sourceIds: this.files.map(file => this.session.sourceId(file)) } : null;
         
        }
        this.render();
      },
      result: result => {
        this.draft = false;
        if (this.enabled && this.ticket) {
          try { this.session.stage(this.ticket.baseId, tool.id, tool.name, this.ticket.sourceIds, result.outputs); }
          catch (error) { this.notice = error instanceof Error ? error.message : 'Unable to keep this result in the session.'; }
        }
        this.render();
      },
      selection: pages => { if (this.enabled) this.session.select(pages); }
    });
    root.addEventListener('change', event => {
      const input = event.target;
      if (input instanceof HTMLInputElement && input.matches(sourceSelector) && input.files?.length) {
        if (this.operation) { event.stopImmediatePropagation(); this.notice = 'Cancel processing before changing source files.'; this.render(); return; }
        this.acceptFiles([...input.files], input.multiple);
      }
    }, { capture: true, signal });
    root.addEventListener('drop', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.drop-zone,[data-workflow-drop]') && event.dataTransfer?.files.length) {
        if (this.operation) { event.preventDefault(); event.stopImmediatePropagation(); return; }
        const input = root.querySelector<HTMLInputElement>(sourceSelector);
        this.acceptFiles([...event.dataTransfer.files], Boolean(input?.multiple));
      }
    }, { capture: true, signal });
    const markDraft = (event: Event): void => {
      const target = event.target;
      if (event.type === 'input' && (!event.isTrusted || (target instanceof Element && target.matches('.organizer-select')))) return;
      if (this.seeded || !(target instanceof Element) || target.closest('.pre-edit-preview,#preview-area')) return;
      if (event.type === 'pointerup' && !(target instanceof HTMLCanvasElement)) return;
      if (event.type === 'input' && target instanceof HTMLInputElement && target.type === 'file') return;
      if (this.enabled && this.session.snapshot().current) this.draft = true;
    };
    root.addEventListener('input', markDraft, { capture: true, signal });
    root.addEventListener('pointerup', markDraft, { capture: true, signal });
    root.addEventListener('submit', event => {
      if (event.target instanceof Element && event.target.matches('#tool-options')) event.preventDefault();
      markDraft(event);
    }, { capture: true, signal });
    root.addEventListener('click', event => {
      if (event.target instanceof Element && event.target.closest('[data-session-inline]')) {
        event.preventDefault(); event.stopImmediatePropagation();
        const file = this.files.find(pdfInput);
        if (file && !this.busy) { this.enabled = true; this.session.start(file); this.filename = file.name; this.draft = true; this.render(); }
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const action = target?.closest<HTMLElement>('[data-organizer-action]')?.dataset.organizerAction;
      if (target?.closest('[data-card-action]') || (action && !['select-all', 'clear-selection'].includes(action))) markDraft(event);
    }, { capture: true, signal });
    this.render();
  }

  mounted(): void {
    const current = this.session.snapshot().current;
    const file = this.viewing ?? current?.file;
    if (this.enabled && file && this.tool?.id !== 'images-to-pdf') {
      const input = this.options.root.querySelector<HTMLInputElement>(sourceSelector);
      if (input) {
        this.seeded = true;
        const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        this.seeded = false;
      }
    }
    this.render();
  }

  private acceptFiles(incoming: File[], multiple: boolean): void {
    const known = this.viewing ?? this.session.snapshot().current?.file;
    if (this.seeded && known && incoming[0]) this.session.aliasSource(incoming[0], known);
    this.files = multiple ? [...this.files, ...incoming] : incoming.slice(0, 1);
    if (this.enabled && !this.session.snapshot().current) {
      const file = this.files.find(pdfInput);
      if (file) { this.session.start(file); this.filename = file.name; }
    }
    if (!this.seeded && this.enabled && this.tool?.id !== 'preview') this.draft = true;
    // The dedicated reader has no separate pre-edit preview.
    if (this.enabled && this.tool?.id === 'preview') queueMicrotask(() => this.options.root.querySelector<HTMLButtonElement>('#run-operation')?.click());
    this.render();
  }

  unmount(): void {
    this.disconnect?.(); this.disconnect = null;
    this.bindings?.abort(); this.bindings = null;
    this.operation = false; this.files = []; this.draft = false; this.allowedLeave = false;
    this.urls.forEach(url => URL.revokeObjectURL(url)); this.urls = [];
  }

  private url(file: File): string { const url = URL.createObjectURL(file); this.urls.push(url); return url; }

  private render(): void {
    const { toolbar, home, dialog } = this.options;
    const outputIndex = Number(toolbar.querySelector<HTMLSelectElement>('[data-session-output]')?.value ?? 0);
    this.urls.forEach(url => URL.revokeObjectURL(url)); this.urls = [];
    const state = this.session.snapshot();
    home.hidden = !state.current;
    home.innerHTML = state.current ? `<div><p class="eyebrow">Your document · this tab only</p><strong>${escape(state.current.file.name)}</strong><p>${escape(state.current.label)} · ${state.history.length} retained revision(s)${state.pending ? ' · result ready to review' : ''}. Export before closing this tab.</p></div><button type="button" class="primary" data-session-resume>Resume document</button>` : '';
    const offered = this.files.find(pdfInput);
    const invitation = this.options.root.querySelector<HTMLButtonElement>('[data-session-inline]');
    if (!this.enabled && offered) {
      let button = invitation;
      if (!button) {
        button = document.createElement('button'); button.type = 'button';
        button.className = 'secondary document-invitation'; button.dataset.sessionInline = 'true';
        button.textContent = 'Keep working with this PDF';
        const input = this.options.root.querySelector<HTMLInputElement>(sourceSelector);
        const pane = this.options.root.querySelector('.legacy-files-pane');
        if (pane) pane.append(button);
        else if (input) (input.closest('.drop-zone') ?? input).insertAdjacentElement('afterend', button);
      }
      button.disabled = this.busy;
    } else invitation?.remove();
    toolbar.hidden = !this.enabled;
    dialog.classList.toggle('has-document-session', !toolbar.hidden);
    if (toolbar.hidden) { toolbar.replaceChildren(); return; }
    if (!this.enabled || !state.current) {
      toolbar.innerHTML = `<div class="session-intro"><div><strong>One PDF, many tools</strong><span>Keep a working copy and history in this tab. Export before closing the tab.</span></div>${offered ? '<button type="button" class="secondary" data-session-action="start">Keep working with this PDF</button>' : '<span>Choose a PDF to begin.</span>'}</div>`;
      return;
    }
    const pending = state.pending;
    const selected = pending?.files[Math.min(outputIndex, pending.files.length - 1)];
    const disabled = this.busy ? 'disabled' : '';
    const inputDiffers = this.files.length && !this.files.some(file => this.session.sourceId(file) === this.session.sourceId(state.current!.file)) && !this.viewing;
    const mode = this.viewing === state.original?.file ? 'Viewing original' : this.viewing && pending?.files.includes(this.viewing) ? 'Viewing result' : 'Working copy';
    toolbar.innerHTML = `
      <div class="session-main"><div class="session-identity"><strong>${escape(state.current.file.name)}</strong><span>${mode} · ${escape(state.current.label)}${state.current.pages ? ' · ' + state.current.pages + ' pages' : ''} · this tab only</span></div>
        <label class="session-tool">Next tool<select data-session-tool aria-label="Next tool" ${this.busy || pending ? 'disabled' : ''}>${tools.filter(tool => tool.id !== 'images-to-pdf').map(tool => `<option value="${tool.id}" ${tool.id === this.tool?.id ? 'selected' : ''}>${escape(tool.name)}</option>`).join('')}</select></label>
        <div class="session-actions"><button type="button" class="secondary" data-session-action="undo" ${!state.canUndo || this.busy ? 'disabled' : ''}>${icon('undo')}Undo revision</button><button type="button" class="secondary" data-session-action="redo" ${!state.canRedo || this.busy ? 'disabled' : ''}>${icon('redo')}Redo revision</button><button type="button" class="secondary" data-session-action="new" ${disabled}>New document</button></div></div>
      <div class="session-export"><div class="session-previews"><button type="button" class="secondary" data-session-action="original" ${disabled}>View original</button><button type="button" class="secondary" data-session-action="current" ${disabled}>View current</button></div><label>Export filename<input data-session-name aria-label="Export filename" value="${escape(this.filename || state.current.file.name)}" maxlength="110"></label><a class="primary session-download" href="${this.url(state.current.file)}" download="${escape(pdfFilename(this.filename || state.current.file.name))}" data-session-action="export">${icon('download')}Export current PDF</a></div>
      ${pending ? `<div class="session-result" role="status"><div><strong>Result ready · not yet applied</strong><span>${pending.exportOnly ? 'Encrypted results are download-only. Unlock a copy before editing it again.' : pending.barrier ? 'Using this redacted result clears all earlier revisions and source previews from this session. Your file on the device stays unchanged.' : 'Review the result, then use it as your next working revision.'}</span></div>${pending.files.length > 1 ? `<label>Choose result<select data-session-output aria-label="Choose PDF result" ${disabled}>${pending.files.map((file, index) => `<option value="${index}" ${index === outputIndex ? 'selected' : ''}>${escape(file.name)}</option>`).join('')}</select></label>` : ''}<button type="button" class="secondary" data-session-action="result" ${disabled}>Review result</button><button type="button" class="primary" data-session-action="apply" ${this.busy || pending.exportOnly ? 'disabled' : ''}>${pending.barrier ? 'Use redacted result and clear history' : 'Use result'}</button><a class="secondary session-download" href="${selected ? this.url(selected) : '#'}" download="${escape(selected?.name ?? 'result.pdf')}">Download result</a><button type="button" class="secondary" data-session-action="discard" ${disabled}>Discard result</button></div>` : ''}
      ${state.selection.length && this.options.root.querySelector('#tool-options input[name=pages]') ? '<button type="button" class="secondary" data-session-action="selection">Use selected pages (' + state.selection.join(', ') + ')</button>' : ''}<details class="session-history"><summary>History (${state.history.length})${state.selection.length ? ' · ' + state.selection.length + ' pages selected' : ''}</summary><ol>${state.history.map((revision, index) => `<li ${index === state.index ? 'aria-current="step"' : ''}>${escape(revision.label)}${index === state.index ? ' · current' : index > state.index ? ' · redo available' : ''}</li>`).join('')}</ol><p>Up to 8 revisions plus the starting file, with a 128 MB history budget. Larger documents retain only the required starting/current copies. ${state.historyLimited ? 'Older undo states were released to limit memory.' : ''} Redaction clears earlier history. Nothing here is saved to disk or cloud.</p></details>
      <p class="session-notice" role="status">${escape(this.notice || (this.busy ? 'Processing locally… Your current revision stays unchanged until you use a result.' : inputDiffers ? 'This tool has a different source selected. Using its result replaces the working copy; the original stays separate.' : this.viewing === state.original?.file && state.original?.label === 'Starting point after redaction' ? 'Earlier source previews were cleared after redaction.' : ''))}</p>`;
  }

  private async click(event: MouseEvent): Promise<void> {
    const button = (event.target as Element).closest<HTMLElement>('[data-session-action]');
    const action = button?.dataset.sessionAction;
    if (!action) return;
    if (action === 'export') { this.session.markExported(); return; }
    if (this.busy) return;
    const state = this.session.snapshot();
    const outputIndex = Number(this.options.toolbar.querySelector<HTMLSelectElement>('[data-session-output]')?.value ?? 0);
    if (action === 'selection') {
      const input = this.options.root.querySelector<HTMLInputElement>('#tool-options input[name=pages]');
      if (input) { input.value = state.selection.join(','); input.dispatchEvent(new Event('input', { bubbles: true })); this.draft = true; input.focus(); }
      return;
    }
    if (action === 'start') {
      const file = this.files.find(pdfInput);
      if (!file) return;
      this.enabled = true; this.session.start(file); this.filename = file.name; this.draft = true; this.render();
      return;
    }
    if (action === 'new') {
      if (!await this.canLeave() || !await confirmAction('Start a new document?', 'Export any current PDF or result you need. Starting again releases this tab’s session and history.', 'Start new document')) return;
      this.session.clear(); this.enabled = true; this.notice = ''; this.filename = '';
      await this.options.open('preview'); return;
    }
    if (action === 'apply') {
      this.applying = true; this.notice = ''; this.render();
      try {
        await this.session.apply(outputIndex, validateSessionPdf);
        this.filename = this.session.snapshot().current!.file.name;
        this.draft = false; this.viewing = null; this.notice = '';
      } catch (error) { this.notice = error instanceof Error ? error.message : 'The result could not be applied.'; }
      finally { this.applying = false; this.render(); }
      if (!this.session.snapshot().pending) await this.options.open(this.tool?.id ?? 'preview');
      return;
    }
    if (action === 'discard') {
      if (await confirmAction('Discard this result?', 'The current working revision stays unchanged. The result will be released from this session.', 'Discard result')) this.session.discardResult();
      return;
    }
    if (!await this.canLeave()) return;
    if (action === 'undo' || action === 'redo') {
      if (action === 'undo') this.session.undo(); else this.session.redo();
      this.draft = false; await this.options.open(this.tool?.id ?? 'preview'); return;
    }
    if (action === 'original' && state.original) await this.options.open('preview', state.original.file);
    if (action === 'current') await this.options.open('preview');
    if (action === 'result' && state.pending) {
      const file = state.pending.files[outputIndex];
      if (file && !state.pending.exportOnly) await this.options.open('preview', file);
      else this.notice = 'Encrypted results must be downloaded and opened with their password.';
    }
    this.render();
  }
}
