import { tools } from '../tools/registry';
import { preservationConsequences } from '../pdf/preservationPolicy';
import { productCopy } from '../content/en';
import { findTools } from './toolDiscovery';

export function mountHelpCenter(host: HTMLElement, open: (id: string) => Promise<void>): void {
  host.innerHTML = `<section class="product-panel"><h2>Help & capabilities</h2><p>Find a task, check its limits and open it without uploading a document.</p><label class="product-label">Find a tool or task<input type="search" data-help-search placeholder="Try make PDF smaller" autocomplete="off"></label><p role="status" data-help-count></p><div data-help-results></div><details><summary>What changed in ${__DOCFLOW_VERSION__}?</summary><h3>${productCopy.release.title}</h3><ul>${productCopy.release.changes.map(change => `<li>${change}</li>`).join('')}</ul><p>Build <code>${__DOCFLOW_BUILD__}</code>. ${productCopy.acceptance}</p></details><details><summary>What is currently unsupported?</summary><p>${productCopy.limits}</p><p>Page-copy tools can lose document-level structure. Cropping hides content. OCR recognition and comparison matching require review. Visual signatures do not validate identity or document integrity.</p></details><details><summary>Offline, updates and recovery</summary><p>Export before closing or updating. Documents and session history live in this tab’s memory. Recovery keeps file metadata and permitted settings; reselect the original files to resume. Prepare engines and OCR models in Offline & storage; browser storage can be evicted.</p><button type="button" class="secondary" data-action="offline">Open Offline & storage</button></details><details><summary>Optional account and support</summary><p>Local PDF tools work without an account. Cloud sync saves favourites and recent-tool IDs only when you choose Save. If confirmation or sign-in fails, check the email address and confirmation message, or continue locally. Sign out or manage your saved preferences in Cloud sync. Local data removal does not delete server data.</p><p>For account-data removal or a reproducible app issue, open the project’s issue tracker yourself. Never post an email address, password, token or private document publicly. Review a diagnostics report first if you choose to attach one. Private account requests should use a private channel already agreed with the service operator; no private support inbox is configured in this app.</p><a href="https://github.com/ZubaerAhmed13/zubaer-ahmed-PDF-TEST/issues" target="_blank" rel="noopener noreferrer">Open issue tracker</a><button type="button" class="secondary" data-action="cloud">Open Cloud sync</button><button type="button" class="secondary" data-action="diagnostics">Review diagnostics</button></details></section>`;
  const search = host.querySelector<HTMLInputElement>('[data-help-search]')!;
  const results = host.querySelector<HTMLElement>('[data-help-results]')!;
  const render = (): void => {
    const matches = findTools(search.value);
    host.querySelector('[data-help-count]')!.textContent = `${matches.length} of ${tools.length} tools`;
    results.replaceChildren();
    if (!matches.length) {
      const message = document.createElement('p'); message.textContent = `No matching task. ${productCopy.limits}`; results.append(message); return;
    }
    for (const tool of matches) {
      const details = document.createElement('details');
      const summary = document.createElement('summary'); summary.textContent = tool.name;
      const description = document.createElement('p'); description.textContent = tool.description;
      const limits = document.createElement('p'); limits.className = 'product-limit'; limits.textContent = preservationConsequences(tool.id).join(' ');
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = `Open ${tool.name}`;
      button.addEventListener('click', () => { void open(tool.id); });
      details.append(summary, description, limits, button); results.append(details);
    }
  };
  search.addEventListener('input', render); render();
  search.focus();
}
