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

  root.innerHTML = `
    <header class="app-header">
      <a class="brand" href="./" aria-label="DocFlow Professional home">
        <span class="brand-mark" aria-hidden="true">D</span>
        <span><strong>DocFlow Professional</strong><small>v0.1.0 migration preview</small></span>
      </a>
      <nav aria-label="Product">
        <button class="ghost" data-action="privacy">Privacy</button>
        <button class="ghost" data-action="diagnostics">Diagnostics</button>
      </nav>
    </header>
    <main id="main">
      <section class="hero">
        <p class="eyebrow">PRIVATE · LOCAL · OFFLINE-CAPABLE</p>
        <h1>Private PDF tools that run directly on your device.</h1>
        <p class="lede">No document upload is required for the migrated core. Operations are designed to preserve PDF structure whenever possible.</p>
        <div class="hero-actions">
          <button class="primary" data-action="open">Open PDF</button>
          <button class="secondary" data-action="focus-search">Choose a tool</button>
        </div>
        <p class="privacy-chip">Your files stay on this device for the migrated local tools.</p>
      </section>

      <section class="quick-access" aria-label="Quick access">
        <article class="quick-panel">
          <div class="quick-heading"><div><p class="eyebrow">FAVORITES</p><h2>Your pinned tools</h2></div></div>
          <div id="favorite-tools" class="quick-links"></div>
        </article>
        <article class="quick-panel">
          <div class="quick-heading"><div><p class="eyebrow">RECENT</p><h2>Recently used</h2></div></div>
          <div id="recent-tools" class="quick-links"></div>
        </article>
      </section>

      <section class="discovery" aria-labelledby="tools-title">
        <div class="section-heading">
          <div><p class="eyebrow">TOOLS</p><h2 id="tools-title">Choose an operation</h2></div>
          <label class="search"><span>Search tools</span><input id="tool-search" type="search" placeholder="Merge, rotate, forms…" autocomplete="off" /></label>
        </div>
        <div class="category-tabs" role="tablist" aria-label="Tool categories">
          <button role="tab" aria-selected="true" data-category="all">All</button>
          ${toolCategories.map((category) => `<button role="tab" aria-selected="false" data-category="${category.id}">${category.label}</button>`).join('')}
        </div>
        <div id="tool-grid" class="tool-grid"></div>
      </section>

      <dialog id="workspace-dialog" class="workspace-dialog" aria-labelledby="workspace-title">
        <form method="dialog" class="dialog-bar"><strong id="workspace-title">Workspace</strong><button aria-label="Close workspace">Close</button></form>
        <div id="workspace" class="workspace"></div>
      </dialog>
      <dialog id="info-dialog" class="info-dialog"><div id="info-content"></div><form method="dialog"><button class="primary">Close</button></form></dialog>
    </main>
    <footer><span>DocFlow Professional migration branch</span><span>Local-first. No analytics configured.</span></footer>
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
      <article class="tool-card" data-tool="${tool.id}">
        <div class="tool-card-top"><span class="tool-icon" aria-hidden="true">${tool.icon}</span>
          <button class="favorite" data-favorite="${tool.id}" aria-pressed="${favorites.has(tool.id)}" aria-label="${favorites.has(tool.id) ? 'Remove from' : 'Add to'} favorites">★</button>
        </div>
        <h3>${tool.name}</h3><p>${tool.description}</p>
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
    if (action === 'focus-search') search.focus();
    if (action === 'open') void openTool('preview');
    if (action === 'privacy') {
      infoContent.innerHTML = '<h2>Privacy</h2><p>The migrated core performs PDF processing in your browser. No analytics, telemetry, crash reporting, trackers, or remote document-processing APIs are configured.</p><p>Favorites and recent-tool IDs are stored in localStorage. Lightweight project recovery stores the selected tool, settings, and file metadata (name, size, type, and last-modified time) in IndexedDB. PDF/image contents are not stored in localStorage or the recovery database; original files must be reselected after recovery.</p>';
      infoDialog.showModal();
    }
    if (action === 'diagnostics') {
      infoContent.innerHTML = `<h2>Diagnostics</h2><dl><dt>Version</dt><dd>0.1.0</dd><dt>Online</dt><dd>${navigator.onLine}</dd><dt>Worker support</dt><dd>${typeof Worker !== 'undefined'}</dd><dt>Service worker</dt><dd>${'serviceWorker' in navigator}</dd><dt>Storage estimate</dt><dd id="storage-estimate">Checking…</dd></dl>`;
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
