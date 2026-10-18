import { mountOfflinePanel } from './offline';
import { DocumentWorkspace } from './documentWorkspace';
import { approveReload, prepareApprovedReload } from './workProtection';
import { toolCategories, tools } from '../tools/registry';
import { getFavorites, setFavorite, subscribeFavorites, replaceFavorites } from './favoriteStore';
import { mountCloudPanel } from './cloudSync';
import { findTools } from './toolDiscovery';
import { mountHelpCenter } from './helpCenter';
import { mountDiagnostics } from './diagnostics';
import { mountPrivacyPanel } from './privacyPanel';
import { productCopy } from '../content/en';

const RECENT_KEY = 'docflow.recent-tools.v1';

function readList(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character] ?? character));
}

export function createApp(root: HTMLDivElement | null): void {
  if (!root) throw new Error('APP_ROOT_MISSING');

  let recent = readList(RECENT_KEY);
  let favorites = getFavorites();
  const categoryCount = new Set(tools.map((tool) => tool.category)).size;

  root.innerHTML = `
    <div class="app-shell">
      <header class="app-header topbar">
        <a class="brand" href="./" aria-label="DocFlow Professional home">
          <span class="brand-mark" aria-hidden="true">D</span>
          <span><strong>docflow</strong><small class="brand-subtitle">PDF workspace</small></span>
        </a>
        <nav class="topbar-nav" aria-label="Product">
          <a href="#tools">All tools</a>
          <a href="#how-it-works">How it works</a>
          <button type="button" data-action="privacy">Privacy</button>
          <button type="button" data-action="help">Help & capabilities</button>
        </nav>
        <div class="topbar-actions">
          <button class="secondary" type="button" data-action="offline">Offline & storage</button><button class="secondary" type="button" data-action="diagnostics">Diagnostics</button>
          <button class="secondary" type="button" data-action="cloud">Cloud sync</button>
          <button class="primary" type="button" data-action="open">Open PDF</button>
        </div>
      </header>

      <main id="main">
        <section class="hero" aria-labelledby="hero-title">
          <div class="hero-copy">
            <p class="eyebrow"><span class="eyebrow-dot" aria-hidden="true"></span> Private · local · offline-capable</p>
            <h1 id="hero-title">Private PDF tools that run <em>directly on your device.</em></h1>
            <p class="lede">A focused workspace for everyday PDF jobs—organize, edit, convert, protect and optimize documents without sending them to a remote processing service.</p>
            <div class="hero-actions">
              <button class="primary" type="button" data-action="open">Open a PDF</button>
              <button class="secondary" type="button" data-action="focus-search">Explore all tools</button>
            </div>
            <div class="hero-microcopy" aria-label="Product benefits">
              <span><b class="hero-check" aria-hidden="true">✓</b> No document upload</span>
              <span><b class="hero-check" aria-hidden="true">✓</b> Offline after setup</span>
              <span><b class="hero-check" aria-hidden="true">✓</b> No analytics configured</span>
            </div>
          </div>

          <div class="hero-art" aria-label="DocFlow local workspace capabilities">
            <div class="workspace-window">
              <div class="window-bar"><span>Workspace overview · illustrative</span><span class="window-dots" aria-hidden="true"><span></span><span></span><span></span></span></div>
              <div class="window-content">
                <div class="window-feature">
                  <div class="window-feature-icon" aria-hidden="true">PDF</div>
                  <div><strong>Work on your device</strong><small>Edit and export without uploading your documents.</small></div>
                  <span class="window-status">Local</span>
                </div>
                <div class="window-feature">
                  <div class="window-feature-icon" aria-hidden="true">▦</div>
                  <div><strong>Professional page workspace</strong><small>Preview, thumbnails, organize, forms and batch tools.</small></div>
                  <span class="window-status">Ready</span>
                </div>
                <div class="window-feature">
                  <div class="window-feature-icon" aria-hidden="true">◆</div>
                  <div><strong>Privacy-first by design</strong><small>Files remain in this browser for local tools.</small></div>
                  <span class="window-status">Private</span>
                </div>
                <div class="window-summary" aria-label="Current product capability summary">
                  <div><strong>${tools.length}</strong><span>Tools</span></div>
                  <div><strong>Local</strong><span>Processing</span></div>
                  <div><strong>${categoryCount}</strong><span>Categories</span></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="product-section task-examples" aria-labelledby="task-examples-title"><div class="product-section-head"><div><p class="eyebrow">Everyday tasks</p><h2 id="task-examples-title">Start with what you need to do</h2><p>Open a task, review its limits and keep your original file.</p></div></div><div class="task-example-grid">${productCopy.examples.map(example => `<article><h3>${example.title}</h3><p>${example.detail}</p><button type="button" class="secondary" data-example-tool="${example.tool}">Start task</button></article>`).join('')}</div><p class="product-scope-note">Add text and visual signatures, fill supported forms or organise pages. Original page-text replacement and Office conversion are not available. <button type="button" data-action="help">Explore capabilities and limits</button></p></section>

        <section class="document-resume" data-document-home hidden aria-label="Current document"></section>
        <section class="quick-access" aria-label="Quick access">
          <article class="quick-panel">
            <div class="quick-heading"><p class="eyebrow">Favorites</p><h2>Your pinned tools</h2></div>
            <div id="favorite-tools" class="quick-links"></div>
          </article>
          <article class="quick-panel">
            <div class="quick-heading"><p class="eyebrow">Recent</p><h2>Recently used</h2></div>
            <div id="recent-tools" class="quick-links"></div>
          </article>
        </section>

        <section class="discovery" id="tools" aria-labelledby="tools-title">
          <div class="section-heading">
            <div><p class="eyebrow">All tools</p><h2 id="tools-title">Choose an operation</h2></div>
            <label class="search">
              <span>Search tools</span>
              <input id="tool-search" type="search" placeholder="Merge, rotate, forms, protect…" autocomplete="off" />
              <span class="search-hint" aria-hidden="true"><kbd>Ctrl</kbd><span>+</span><kbd>K</kbd></span>
            </label>
          </div>
          <div class="category-tabs" role="tablist" aria-label="Tool categories">
            <button role="tab" aria-selected="true" data-category="all">All tools</button>
            ${toolCategories.map((category) => `<button role="tab" aria-selected="false" data-category="${category.id}">${category.label}</button>`).join('')}
          </div>
          <p class="discovery-count" role="status" data-discovery-count></p><div id="tool-grid" class="tool-grid"></div>
        </section>

        <section class="product-section" id="how-it-works" aria-labelledby="how-title">
          <div class="product-section-head">
            <div><p class="eyebrow">Simple workflow</p><h2 id="how-title">From file to finished result</h2><p>DocFlow keeps the workflow focused: choose an operation, work locally, validate the result, then download only when you are ready.</p></div>
          </div>
          <div class="steps-grid">
            <article class="step-card"><span class="step-number">01</span><h3>Choose a tool</h3><p>Search or browse by category. Favorites and recent tools keep common jobs close.</p></article>
            <article class="step-card"><span class="step-number">02</span><h3>Add your document</h3><p>Choose files from your device and review any file or memory warnings.</p></article>
            <article class="step-card"><span class="step-number">03</span><h3>Work locally</h3><p>Review the preview and options, then apply your changes on this device.</p></article>
            <article class="step-card"><span class="step-number">04</span><h3>Download the result</h3><p>Download a new copy and review it before sharing. Your original file stays unchanged.</p></article>
          </div>
        </section>

        <section class="product-section" id="privacy-section" aria-labelledby="privacy-title">
          <div class="product-section-head">
            <div><p class="eyebrow">Privacy & trust</p><h2 id="privacy-title">Your documents stay under your control</h2><p>The current professional core has no remote PDF-processing API, analytics or telemetry configured. Recovery stores lightweight settings and file metadata—not document bytes.</p></div>
          </div>
          <div class="trust-grid">
            <article class="trust-card"><span class="trust-icon" aria-hidden="true">✓</span><div><strong>Local processing</strong><p>Core PDF and image operations execute in the browser instead of uploading files to a processing server.</p></div></article>
            <article class="trust-card"><span class="trust-icon" aria-hidden="true">◎</span><div><strong>Offline-ready core</strong><p>The application shell and local engines are precached for offline use where the browser permits worker execution. Check stored files and prepare English/German OCR in Offline & storage.</p></div></article>
            <article class="trust-card"><span class="trust-icon" aria-hidden="true">i</span><div><strong>Clear export choices</strong><p>Review quality changes and supported features before you export.</p></div></article>
          </div>
        </section>

        <dialog id="workspace-dialog" class="workspace-dialog" aria-labelledby="workspace-title">
          <form method="dialog" class="dialog-bar"><strong id="workspace-title">Workspace</strong><button type="button" data-action="help">Find tools and help</button><button type="button" data-action="offline">Help & offline</button><button aria-label="Close workspace">Close</button></form>
          <section class="document-toolbar" data-document-toolbar hidden aria-label="Document session"></section>
          <div id="workspace" class="workspace"></div>
        </dialog>
        <dialog id="info-dialog" class="info-dialog"><div id="info-content"></div><form method="dialog"><button class="primary">Close</button></form></dialog>
      </main>

      <footer>
        <span class="footer-brand"><span class="mini-mark" aria-hidden="true">D</span> docflow · v${__DOCFLOW_VERSION__}</span><button type="button" data-action="help">Help & release notes</button>
        <span class="footer-links"><button type="button" data-action="offline">Offline & storage</button><button type="button" data-action="privacy">Privacy</button><button type="button" data-action="diagnostics">Diagnostics</button><button type="button" data-action="cloud">Cloud sync</button><span>Local-first · no analytics</span></span>
      </footer>
    </div>
  `;

  const grid = root.querySelector<HTMLDivElement>('#tool-grid');
  const search = root.querySelector<HTMLInputElement>('#tool-search');
  const workspaceDialog = root.querySelector<HTMLDialogElement>('#workspace-dialog');
  const workspace = root.querySelector<HTMLDivElement>('#workspace');
  const infoDialog = root.querySelector<HTMLDialogElement>('#info-dialog');
  const infoContent = root.querySelector<HTMLDivElement>('#info-content');
  const favoriteTools = root.querySelector<HTMLDivElement>('#favorite-tools');
  const recentTools = root.querySelector<HTMLDivElement>('#recent-tools');
  if (!grid || !search || !workspaceDialog || !workspace || !infoDialog || !infoContent || !favoriteTools || !recentTools) return;

  let disposeInfo: (() => void) | null = null;
  infoDialog.addEventListener('close', () => { disposeInfo?.(); disposeInfo = null; });
  let category = 'all';
  let workspaceGeneration = 0;
  let workspaceTrigger: HTMLElement | null = null;

  const documents = new DocumentWorkspace({
    root: workspace, dialog: workspaceDialog,
    toolbar: root.querySelector<HTMLElement>('[data-document-toolbar]')!,
    home: root.querySelector<HTMLElement>('[data-document-home]')!,
    open: (id, view) => openTool(id, null, view)
  });
  const closeWorkspace = async (): Promise<void> => {
    if (await documents.canLeave()) workspaceDialog.close();
  };
  // Own every close path, including native form submission, the restored
  // header/footer buttons and Escape. Active work is never silently cancelled.
  workspaceDialog.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('[data-legacy-header-close],.legacy-footer-close,.dialog-bar button:not([data-action]),[data-load-close]')) return;
    event.preventDefault(); event.stopImmediatePropagation(); void closeWorkspace();
  }, true);
  workspaceDialog.addEventListener('cancel', event => {
    if (event.target !== workspaceDialog) return; // A file picker also emits a bubbling cancel event.
    event.preventDefault(); void closeWorkspace();
  });

  const toolButtons = (ids: string[], emptyMessage: string): string => {
    const available = ids.map((id) => tools.find((tool) => tool.id === id)).filter((tool): tool is NonNullable<typeof tool> => Boolean(tool));
    if (!available.length) return `<p class="quick-empty">${emptyMessage}</p>`;
    return available.map((tool) => `<button type="button" class="quick-tool" data-open-tool="${tool.id}"><span aria-hidden="true">${tool.icon}</span><strong>${tool.name}</strong><small>${tool.category}</small></button>`).join('');
  };

  const renderQuickAccess = (): void => {
    favoriteTools.innerHTML = toolButtons([...favorites], 'Pin a tool with the star button and it will appear here.');
    recentTools.innerHTML = toolButtons(recent, 'Tools you open will appear here without storing document contents.');
  };

  const render = (): void => {
    const visible = findTools(search.value, category);
    root.querySelector('[data-discovery-count]')!.textContent = `${visible.length} of ${tools.length} tools`;
    grid.innerHTML = visible.map((tool) => `
      <article class="tool-card" data-tool="${tool.id}" data-category="${tool.category}">
        <div class="tool-card-top">
          <span class="tool-icon" aria-hidden="true">${tool.icon}</span>
          <button class="favorite" data-favorite="${tool.id}" aria-pressed="${favorites.has(tool.id)}" aria-label="${favorites.has(tool.id) ? 'Remove from' : 'Add to'} favorites">★</button>
        </div>
        <p class="tool-category-label">${tool.category}</p>
        <h3>${tool.name}</h3>
        <p>${tool.description}</p>
        <div class="tool-meta"><span>${tool.quality}</span><span>On-device</span></div>
        <button class="card-action" data-open-tool="${tool.id}">Open tool</button>
      </article>
    `).join('') || `<div class="empty-state"><strong>No tools found</strong><p>Try another search or category. Office conversion and original page-text replacement are not available.</p><button type="button" class="secondary" data-reset-search>Reset search and category</button><button type="button" class="secondary" data-action="help">Check capabilities</button></div>`;
  };

  subscribeFavorites((nextFavorites) => {
    favorites = new Set(nextFavorites);
    render();
    renderQuickAccess();
  });

  const sessionIsActive = (generation: number): boolean => generation === workspaceGeneration && workspaceDialog.open;

  const openTool = async (id: string, trigger: HTMLElement | null = null, view?: File): Promise<void> => {
    const tool = tools.find((candidate) => candidate.id === id);
    if (!tool) return;
    // Capture before the asynchronous leave guard consumes the retry marker.
    const recoveryRetry = new URL(location.href).searchParams.get('docflowRetry') === id;
    if (!await documents.canLeave()) { documents.refresh(); return; }
    documents.unmount();
    workspace.dispatchEvent(new CustomEvent('docflow-cleanup'));
    workspaceDialog.classList.remove('legacy-exact-active');
    const generation = ++workspaceGeneration;
    if (trigger) workspaceTrigger = trigger;
    recent = [id, ...recent.filter((item) => item !== id)].slice(0, 6);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch { /* Local storage can be disabled; PDF tools must still open. */ }
    renderQuickAccess();
    workspace.innerHTML = `<div class="workspace-loading" role="status">Loading ${escapeHtml(tool.name)}…</div>`;
    if (!workspaceDialog.open) workspaceDialog.showModal();

    try {
      const module = await tool.load(recoveryRetry);
      if (!sessionIsActive(generation)) return;
      documents.prepare(tool, view);
      module.mountWorkspace(workspace, tool);
      document.dispatchEvent(new CustomEvent('docflow-workspace-mounted'));
      documents.mounted();
    } catch (error) {
      if (!sessionIsActive(generation)) return;
      console.error('DocFlow tool load failed', {
        toolId: tool.id,
        timestamp: new Date().toISOString(),
        buildMode: import.meta.env.MODE,
        error
      });
      workspace.innerHTML = `
        <section class="workspace-load-error" role="alert" data-load-error-for="${escapeHtml(tool.id)}">
          <h3>Unable to open ${escapeHtml(tool.name)}</h3>
          <p>The editor files could not be loaded.</p>
          <p>If the application was recently updated, reload the page to use the newest deployment.</p>
          <div class="workspace-load-error-actions">
            <button class="primary" type="button" data-load-retry>Retry</button>
            <button class="secondary" type="button" data-load-close>Close</button>
            <button class="secondary" type="button" data-load-reload>Reload application</button>
          </div>
        </section>
      `;
      workspace.querySelector<HTMLButtonElement>('[data-load-retry]')?.addEventListener('click', () => { void openTool(id, workspaceTrigger); });
      workspace.querySelector<HTMLButtonElement>('[data-load-close]')?.addEventListener('click', () => workspaceDialog.close());
      workspace.querySelector<HTMLButtonElement>('[data-load-reload]')?.addEventListener('click', async () => { if (await approveReload()) { prepareApprovedReload(); location.reload(); } });
      workspace.querySelector<HTMLButtonElement>('[data-load-retry]')?.focus();
    }
  };

  grid.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-reset-search]')) {
      search.value = ''; category = 'all';
      root.querySelectorAll<HTMLButtonElement>('[role="tab"]').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.category === 'all')));
      render(); search.focus(); return;
    }
    const fav = target.closest<HTMLButtonElement>('[data-favorite]');
    if (fav) {
      const id = fav.dataset.favorite;
      if (!id) return;
      setFavorite(id, !favorites.has(id));
      return;
    }
    const open = target.closest<HTMLButtonElement>('[data-open-tool]');
    if (open?.dataset.openTool) void openTool(open.dataset.openTool, open);
  });

  root.querySelector('.quick-access')?.addEventListener('click', (event) => {
    const open = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-open-tool]');
    if (open?.dataset.openTool) void openTool(open.dataset.openTool, open);
  });
  root.querySelector('.task-examples')?.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-example-tool]');
    if (button?.dataset.exampleTool) void openTool(button.dataset.exampleTool, button);
  });

  const openHelp = (): void => {
    disposeInfo?.(); disposeInfo = null;
    infoDialog.setAttribute('aria-label', 'Help & capabilities');
    mountHelpCenter(infoContent, async id => { infoDialog.close(); await openTool(id); });
    infoDialog.showModal();
    infoContent.querySelector<HTMLInputElement>('[data-help-search]')?.focus();
  };

  search.addEventListener('input', render);
  root.querySelector('.category-tabs')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-category]');
    if (!button?.dataset.category) return;
    category = button.dataset.category;
    root.querySelectorAll<HTMLButtonElement>('[role="tab"]').forEach((tab) => tab.setAttribute('aria-selected', String(tab === button)));
    render();
  });

  root.addEventListener('click', (event) => {
    const actionTarget = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    const action = actionTarget?.dataset.action;
    if (action === 'focus-search') {
      search.focus();
      search.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (action === 'open') { workspaceTrigger = actionTarget ?? null; void documents.begin(); }
    if (action === 'help') openHelp();
    if (['offline', 'cloud', 'privacy', 'diagnostics'].includes(action ?? '')) { disposeInfo?.(); disposeInfo = null; infoDialog.setAttribute('aria-label', action === 'offline' ? 'Offline and storage' : action!); }
    if (action === 'offline') { disposeInfo = mountOfflinePanel(infoContent); infoDialog.setAttribute('aria-label', 'Offline and storage'); infoDialog.showModal(); }
    if (action === 'cloud') {
      mountCloudPanel(infoContent, {
        allowedToolIds: new Set(tools.map((tool) => tool.id)),
        capture: () => ({ favorite_tools: [...getFavorites()], recent_tools: recent }),
        apply: (state) => {
          replaceFavorites(state.favorite_tools);
          recent = state.recent_tools;
          try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch { /* Local tools remain usable. */ }
          renderQuickAccess();
        }
      });
      infoDialog.showModal();
    }
    if (action === 'privacy') {
      mountPrivacyPanel(infoContent, { workspaceOpen: workspaceDialog.open, clearPreferences: () => {
        localStorage.removeItem('docflow.favorites.v1'); localStorage.removeItem(RECENT_KEY);
        recent = []; replaceFavorites([]); renderQuickAccess();
      } });
      infoDialog.showModal();
    }
    if (action === 'diagnostics') {
      infoDialog.setAttribute('aria-label', 'Diagnostics');
      disposeInfo = mountDiagnostics(infoContent);
      infoDialog.showModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (document.querySelector('dialog[open]:not(#workspace-dialog):not(#info-dialog)')) return;
      if (workspaceDialog.open || infoDialog.open) openHelp();
      else search.focus();
    }
  });

  workspaceDialog.addEventListener('close', () => {
    workspaceGeneration += 1;
    documents.unmount();
    workspace.dispatchEvent(new CustomEvent('docflow-cleanup'));
    workspace.replaceChildren();
    const trigger = workspaceTrigger;
    workspaceTrigger = null;
    if (trigger?.isConnected) queueMicrotask(() => {
      // The close event can arrive after native focus restoration. Never steal
      // focus back if the user has already moved to another control.
      const active = document.activeElement;
      if (!active || active === document.body || active === document.documentElement ||
          workspaceDialog.contains(active) || active === trigger) {
        trigger.focus({ preventScroll: true });
      }
    });
  });

  render();
  renderQuickAccess();
}
