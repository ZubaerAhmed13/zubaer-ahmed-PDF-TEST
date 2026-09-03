import { toolCategories, tools } from '../tools/registry';

const RECENT_KEY = 'docflow.recent-tools.v1';
const FAVORITES_KEY = 'docflow.favorites.v1';

function readList(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function createApp(root: HTMLDivElement | null): void {
  if (!root) throw new Error('APP_ROOT_MISSING');

  let recent = readList(RECENT_KEY);
  const favorites = new Set(readList(FAVORITES_KEY));
  const migratedCount = tools.filter((tool) => tool.status === 'Migrated').length;
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
        </nav>
        <div class="topbar-actions">
          <button class="secondary" type="button" data-action="diagnostics">Diagnostics</button>
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
              <span><b class="hero-check" aria-hidden="true">✓</b> Works offline after install</span>
              <span><b class="hero-check" aria-hidden="true">✓</b> No analytics configured</span>
            </div>
          </div>

          <div class="hero-art" aria-label="DocFlow local workspace capabilities">
            <div class="workspace-window">
              <div class="window-bar"><span>Local workspace</span><span class="window-dots" aria-hidden="true"><span></span><span></span><span></span></span></div>
              <div class="window-content">
                <div class="window-feature">
                  <div class="window-feature-icon" aria-hidden="true">PDF</div>
                  <div><strong>Worker-backed processing</strong><small>Heavy operations stay off the main UI thread.</small></div>
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
                  <div><strong>${migratedCount}</strong><span>Migrated</span></div>
                  <div><strong>${categoryCount}</strong><span>Categories</span></div>
                </div>
              </div>
            </div>
          </div>
        </section>

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
          <div id="tool-grid" class="tool-grid"></div>
        </section>

        <section class="product-section" id="how-it-works" aria-labelledby="how-title">
          <div class="product-section-head">
            <div><p class="eyebrow">Simple workflow</p><h2 id="how-title">From file to finished result</h2><p>DocFlow keeps the workflow focused: choose an operation, work locally, validate the result, then download only when you are ready.</p></div>
          </div>
          <div class="steps-grid">
            <article class="step-card"><span class="step-number">01</span><h3>Choose a tool</h3><p>Search or browse by category. Favorites and recent tools keep common jobs close.</p></article>
            <article class="step-card"><span class="step-number">02</span><h3>Add your document</h3><p>Input validation, file metadata and memory warnings happen before heavy processing begins.</p></article>
            <article class="step-card"><span class="step-number">03</span><h3>Work locally</h3><p>PDF.js, pdf-lib and qpdf WASM run in-browser with workers, progress and cancellation where applicable.</p></article>
            <article class="step-card"><span class="step-number">04</span><h3>Download the result</h3><p>Export-capable tools validate generated artifacts in automated release tests before they are considered migrated.</p></article>
          </div>
        </section>

        <section class="product-section" id="privacy-section" aria-labelledby="privacy-title">
          <div class="product-section-head">
            <div><p class="eyebrow">Privacy & trust</p><h2 id="privacy-title">Your documents stay under your control</h2><p>The current professional core has no remote PDF-processing API, analytics or telemetry configured. Recovery stores lightweight settings and file metadata—not document bytes.</p></div>
          </div>
          <div class="trust-grid">
            <article class="trust-card"><span class="trust-icon" aria-hidden="true">✓</span><div><strong>Local processing</strong><p>Core PDF and image operations execute in the browser instead of uploading files to a processing server.</p></div></article>
            <article class="trust-card"><span class="trust-icon" aria-hidden="true">◎</span><div><strong>Offline-ready core</strong><p>The application shell and local engines are precached for offline use where the browser permits worker execution.</p></div></article>
            <article class="trust-card"><span class="trust-icon" aria-hidden="true">i</span><div><strong>Honest capability labels</strong><p>Tools expose quality and migration status, and unsupported capabilities are not presented as working features.</p></div></article>
          </div>
        </section>

        <dialog id="workspace-dialog" class="workspace-dialog" aria-labelledby="workspace-title">
          <form method="dialog" class="dialog-bar"><strong id="workspace-title">Workspace</strong><button aria-label="Close workspace">Close</button></form>
          <div id="workspace" class="workspace"></div>
        </dialog>
        <dialog id="info-dialog" class="info-dialog"><div id="info-content"></div><form method="dialog"><button class="primary">Close</button></form></dialog>
      </main>

      <footer>
        <span class="footer-brand"><span class="mini-mark" aria-hidden="true">D</span> docflow · PDF workspace</span>
        <span class="footer-links"><button type="button" data-action="privacy">Privacy</button><button type="button" data-action="diagnostics">Diagnostics</button><span>Local-first · no analytics</span></span>
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

  let category = 'all';

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
    const query = search.value.trim().toLowerCase();
    const visible = tools.filter((tool) =>
      (category === 'all' || tool.category === category) &&
      (!query || `${tool.name} ${tool.description} ${tool.keywords.join(' ')}`.toLowerCase().includes(query))
    );
    grid.innerHTML = visible.map((tool) => `
      <article class="tool-card" data-tool="${tool.id}" data-category="${tool.category}">
        <div class="tool-card-top">
          <span class="tool-icon" aria-hidden="true">${tool.icon}</span>
          <button class="favorite" data-favorite="${tool.id}" aria-pressed="${favorites.has(tool.id)}" aria-label="${favorites.has(tool.id) ? 'Remove from' : 'Add to'} favorites">★</button>
        </div>
        <p class="tool-category-label">${tool.category}</p>
        <h3>${tool.name}</h3>
        <p>${tool.description}</p>
        <div class="tool-meta"><span>${tool.quality}</span><span>${tool.status}</span></div>
        <button class="card-action" data-open-tool="${tool.id}">Open tool</button>
      </article>
    `).join('') || `<div class="empty-state"><strong>No tools found</strong><p>Try another search or category.</p></div>`;
  };

  const saveFavorites = (): void => localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));

  const openTool = async (id: string): Promise<void> => {
    const tool = tools.find((candidate) => candidate.id === id);
    if (!tool) return;
    recent = [id, ...recent.filter((item) => item !== id)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    renderQuickAccess();
    workspace.innerHTML = `<div class="workspace-loading" role="status">Loading ${tool.name}…</div>`;
    workspaceDialog.showModal();
    const module = await tool.load();
    module.mountWorkspace(workspace, tool);
  };

  grid.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const fav = target.closest<HTMLButtonElement>('[data-favorite]');
    if (fav) {
      const id = fav.dataset.favorite;
      if (!id) return;
      if (favorites.has(id)) favorites.delete(id);
      else favorites.add(id);
      saveFavorites();
      render();
      renderQuickAccess();
      return;
    }
    const open = target.closest<HTMLButtonElement>('[data-open-tool]');
    if (open?.dataset.openTool) void openTool(open.dataset.openTool);
  });

  root.querySelector('.quick-access')?.addEventListener('click', (event) => {
    const open = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-open-tool]');
    if (open?.dataset.openTool) void openTool(open.dataset.openTool);
  });

  search.addEventListener('input', render);
  root.querySelector('.category-tabs')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-category]');
    if (!button?.dataset.category) return;
    category = button.dataset.category;
    root.querySelectorAll<HTMLButtonElement>('[role="tab"]').forEach((tab) => tab.setAttribute('aria-selected', String(tab === button)));
    render();
  });

  root.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'focus-search') {
      search.focus();
      search.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (action === 'open') void openTool('preview');
    if (action === 'privacy') {
      infoContent.innerHTML = '<h2>Privacy</h2><p>DocFlow performs the migrated PDF-processing core in your browser. No analytics, telemetry, crash reporting, trackers, or remote document-processing APIs are configured.</p><p>Favorites and recent-tool IDs are stored in localStorage. Lightweight project recovery stores the selected tool, settings, and file metadata (name, size, type, and last-modified time) in IndexedDB. PDF/image contents and encryption passwords are not stored in localStorage or the recovery database; original files must be reselected after recovery.</p>';
      infoDialog.showModal();
    }
    if (action === 'diagnostics') {
      infoContent.innerHTML = `<h2>Diagnostics</h2><dl><dt>Version</dt><dd>1.0 professional core</dd><dt>Online</dt><dd>${navigator.onLine}</dd><dt>Worker support</dt><dd>${typeof Worker !== 'undefined'}</dd><dt>Service worker</dt><dd>${'serviceWorker' in navigator}</dd><dt>Storage estimate</dt><dd id="storage-estimate">Checking…</dd></dl>`;
      infoDialog.showModal();
      if (navigator.storage?.estimate) void navigator.storage.estimate().then(({usage, quota}) => {
        const field = document.querySelector<HTMLElement>('#storage-estimate');
        if (field) field.textContent = `${Math.round((usage ?? 0) / 1048576)} MB used / ${Math.round((quota ?? 0) / 1048576)} MB available`;
      });
    }
  });

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      search.focus();
    }
  });

  workspaceDialog.addEventListener('close', () => {
    workspace.dispatchEvent(new CustomEvent('docflow-cleanup'));
    workspace.replaceChildren();
  });

  render();
  renderQuickAccess();
}
