import { runWorkerOperation, type RunningOperation } from '../pdf/workerClient';
import type { DocumentInspection } from '../pdf/documentInspection';
import { preservationConsequences } from '../pdf/preservationPolicy';

/** Keeps only small inventories. Files and parsed documents are never persisted. */
export class DocumentSafety {
  private readonly panel = document.createElement('section');
  private generation = 0;
  private readonly observer: MutationObserver;
  private running: RunningOperation | null = null;
  private files: readonly File[] = [];
  private disposed = false;
  private readonly cache = new WeakMap<File, DocumentInspection>();
  constructor(private root: HTMLElement, private tool: string) {
    this.panel.className = 'document-safety'; this.panel.dataset.documentSafety = 'true';
    this.panel.setAttribute('aria-label', 'PDF preservation and safety');
    this.panel.hidden = true;
    this.place();
    this.observer=new MutationObserver(()=>this.place());
    this.observer.observe(root,{childList:true,subtree:true});
  }
  private place():void {
    if(this.disposed)return;
    const host=this.root.querySelector<HTMLElement>('.legacy-settings-pane') ?? this.root.querySelector<HTMLElement>('.direct-editor,.pro-body,.batch-main,.workspace-main') ?? this.root;
    if(this.panel.parentElement!==host)host.prepend(this.panel);
  }
  setFiles(files: readonly File[]): void {
    const pdfs = files.filter(file => file.type === 'application/pdf' || /\.pdf$/i.test(file.name));
    if (pdfs.length === this.files.length && pdfs.every((file,i) => file === this.files[i])) return;
    this.place();
    this.files = pdfs; const generation = ++this.generation;
    this.running?.cancel(); this.running = null;
    this.panel.replaceChildren(); this.panel.hidden = !pdfs.length;
    if (!pdfs.length) return;
    const heading = document.createElement('strong'); heading.textContent = 'Before export · preservation and safety';
    this.panel.append(heading);
    for (const message of preservationConsequences(this.tool)) this.add(message);
    this.add('Every PDF rewrite can invalidate digital signatures. Inspection detects structures only; it does not validate signatures or certify a document as safe.');
    const details = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = 'Local document inspection'; details.append(summary); this.panel.append(details);
    void (async () => {
      for (const file of pdfs) {
        if (this.disposed || generation !== this.generation) return;
        const row = document.createElement('p'); row.textContent = file.name + ': inspecting locally…'; details.append(row);
        try {
          let report = this.cache.get(file);
          if (!report) {
            if (file.size > 150 * 1024 * 1024) throw Error('Inspection limit: 150 MB per file.');
            const buffer = await file.arrayBuffer();
            if (this.disposed || generation !== this.generation) return;
            this.running = runWorkerOperation('document-inspect', [{ name: file.name, type: 'application/pdf', buffer }], {}, () => {});
            const result = await this.running.result;
            report = JSON.parse(String(result.info?.inspection)) as DocumentInspection;
            this.cache.set(file, report);
          }
          if (this.disposed || generation !== this.generation) return;
          row.textContent = file.name + ': ' + report.pages + ' pages; ' + report.objects + ' PDF objects. Detected: ' + (report.features.join(', ') || 'no inventoried document structures') + '.';
          const warnings = preservationConsequences(this.tool, report).slice(preservationConsequences(this.tool).length);
          for (const message of warnings) this.add(file.name + ': ' + message);
          if (!report.signed && !report.certified) row.textContent += ' No signature structures detected (not signature validation).';
        } catch (error) {
          if (this.disposed || generation !== this.generation) return;
          row.textContent = file.name + ': inspection incomplete. ' + (error instanceof Error ? error.message : 'Could not inspect this PDF.') + ' Encrypted, damaged or unsupported structures may remain. No safety conclusion is available.';
        } finally { if (generation === this.generation) this.running = null; }
      }
    })();
  }
  private add(message: string): void { const p = document.createElement('p'); p.textContent = message; this.panel.append(p); }
  destroy(): void { this.observer.disconnect(); this.disposed = true; ++this.generation; this.running?.cancel(); this.running = null; this.files = []; this.panel.remove(); }
}
