import { runWorkerOperation } from '../pdf/workerClient';
import type { OperationResult, WorkerOperation } from '../pdf/types';
import { createPreview, pdfToImages, type PreviewController } from '../pdf/render';
import { activeTools, getTool, groups, v2Tools, type V2Tool } from './catalog';
import { mountPageOrganizer, type PageOrganizer } from './pageOrganizer';
import { V2ImagePreview } from './imagePreview';
import { mountPdfThumbnailRail, type ThumbnailRail } from './thumbnailRail';
import { V2PageEditor } from './pageEditor';
import { extractAndSearchText } from '../pdf/textExtraction';
import { comparePdfs } from '../pdf/pdfComparison';
import { runQpdfOperation } from '../pdf/qpdfWorkerClient';
import { mountReview, type ReviewData } from './reviewResults';
import {createEditorDraft,createOrganizerDraft,safeOptionValues,restoreOptions} from './draft';
import {mountToolSearch} from './toolSearch';
import {compressionPresets,compressionSettings,compressionSummary} from './compression';
import type {NativeEditPlan} from '../pdf/nativeModel';
import type {RunningOperation} from '../pdf/workerClient';
import {validateInputBudget} from '../pdf/resourceBudget';
import {extractEmbeddedImages} from '../pdf/embeddedImages';
import {V2Reader} from './reader';

const esc=(value:string):string=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const bytes=(value:number):string=>value<1024?value+' B':value<1048576?(value/1024).toFixed(1)+' KB':(value/1048576).toFixed(1)+' MB';
const base='#/tools/';
type Stage='upload'|'work'|'result';
type Route={id:string|null;stage:Stage};
const route=():Route=>{
  const match=location.hash.match(/^#\/tools\/([a-z0-9-]+)(?:\/(work|result))?$/);
  return match?{id:match[1]??null,stage:(match[2]??'upload') as Stage}:{id:null,stage:'upload'};
};
const field=(name:string,title:string,value:string,kind:'text'|'number'|'textarea'='text')=>kind==='textarea'
  ?`<label class="df2-control"><span>${title}</span><textarea name="${name}" rows="3">${esc(value)}</textarea></label>`
  :`<label class="df2-control"><span>${title}</span><input type="${kind}" name="${name}" value="${esc(value)}"></label>`;
const select=(name:string,title:string,values:[string,string][])=>`<label class="df2-control"><span>${title}</span><select name="${name}">${values.map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label>`;
function toolOptions(id:string):string{
  switch(id){
    case 'preview':return `<label class="df2-control">Page number<input type="number" name="readerPage" min="1" step="1" value="1"></label><button type="button" class="df2-btn df2-btn-outline" data-reader-go>Go to page</button><p data-reader-status role="status" aria-live="polite">Preparing text selection…</p><p>Read, zoom and select existing PDF text. Downloading keeps the original bytes. Scanned pages need OCR for selectable text.</p>`;
    case 'extract-images':return `<p class="df2-organize-warning">Extracts supported embedded raster objects as PNGs, retaining their pixel dimensions. Masks and grouped inline atlases are reported as skipped. Vectors are not raster images. Original compressed streams and source metadata are not preserved. Up to 1,000 image records, 16 million pixels per image and 150 MB of encoded images.</p>`;
    case 'protect-pdf': return `<label class="df2-control"><span>New PDF password</span><input type="password" name="securityPassword" autocomplete="new-password" minlength="8" maxlength="127" required></label><label class="df2-control"><span>Confirm password</span><input type="password" name="confirmPassword" autocomplete="new-password" minlength="8" maxlength="127" required></label><p class="df2-organize-warning">AES-256 PDF encryption via qpdf. The password is required to open the resulting PDF. DocFlow cannot recover forgotten passwords.</p>`;
    case 'unlock-pdf': return `<label class="df2-control"><span>PDF password</span><input type="password" name="securityPassword" autocomplete="current-password" maxlength="127" required></label><p class="df2-organize-warning">Only unlock PDFs you are authorised to access. Enter the existing PDF password; qpdf validates it before removing encryption.</p>`;
    case 'repair-pdf': return `<p class="df2-organize-warning">Attempts to recover damaged PDF cross-references and rewrite structure. This cannot reconstruct missing text, images, or irreparably damaged pages.</p>`;
    case 'text-search': return field('query','Search phrase (optional)','')+`<p class="df2-organize-warning">Find text that is already selectable in the PDF and export plain text and Markdown. Scanned pages require OCR. The PDF itself is not modified.</p>`;
    case 'compare': return select('mode','Comparison',[['both','Text + visual'],['text','Text only'],['visual','Visual only']])+select('maxPages','Check first pages',[['10','10 pages'],['20','20 pages'],['35','35 pages'],['50','50 pages']])+`<p class="df2-organize-warning">Upload exactly two PDFs, A then B. Matches are heuristic; visually small edits may not be detected. Reports are for review, not legal certification.</p>`;
    case 'pdf-to-images': return select('format','Image format',[['png','PNG · lossless'],['jpeg','JPG · smaller']])+select('scale','Image resolution',[['1','Standard · 1×'],['1.5','High · 1.5×'],['2','Very high · 2×']])+`<p class="df2-organize-warning">Converts the visual appearance of each page into an image. Original selectable text and PDF vector objects are not preserved in images.</p>`;
    case 'organize': return `<p class="df2-organize-warning">Arrange page cards in the document area. Reordering preserves page contents. Duplicated pages may increase file size.</p>`;
    case 'compress': return select('compressionPreset','Image compression',[['balanced','Balanced quality'],['quality','Higher image quality'],['small','Smaller images'],['custom','Custom settings']])+`<details class="df2-compression-details"><summary>Advanced compression</summary><label class="df2-control">JPEG image quality (%)<input name="jpegQuality" type="number" min="50" max="95" step="1" value="79"></label><label class="df2-control">Maximum image dimension (px)<input name="maxImagePixels" type="number" min="900" max="5000" step="1" value="2200"></label><p>Images above this pixel size are downsampled. This is a pixel limit, not DPI. Smaller images and lower quality can reduce detail.</p></details><p class="df2-organize-warning">Recompresses eligible RGB JPEG images while preserving text and vectors. Other encodings are left unchanged. Results depend on the document.</p>`;
    case 'split':return select('mode','Split method',[['selected','Selected pages'],['ranges','Page ranges'],['individual','Individual pages'],['every','Every N pages']])+field('pages','Pages to extract','1')+field('ranges','Separate ranges (semicolon)','1-2;3-4')+field('every','Pages in each part','5','number');
    case 'remove-pages':return field('pages','Pages to remove','');
    case 'extract-pages':return field('pages','Pages to extract','');
    case 'rotate':return select('target','Rotate',[['all','All pages'],['odd','Odd pages'],['even','Even pages'],['selected','Selected pages']])+select('degrees','Rotation',[['90','90° clockwise'],['180','180°'],['270','270° clockwise']])+field('pages','Selected pages (when needed)','');
    case 'page-numbers':return field('pages','Pages (blank means all)','')+field('start','Start at','1','number')+select('format','Format',[['page-total','Page 1 of N'],['page','Page 1'],['number','1']])+field('fontSize','Size (points)','11','number')+field('margin','Bottom margin','24','number');
    case 'watermark':return field('text','Watermark text','CONFIDENTIAL')+field('opacity','Opacity 0.05 – 1','0.18','number')+field('rotation','Angle','-35','number')+field('fontSize','Font size','42','number');
    case 'crop':return field('pages','Pages (blank means all)','')+field('left','Left margin','24','number')+field('right','Right margin','24','number')+field('top','Top margin','24','number')+field('bottom','Bottom margin','24','number');
    case 'annotate':return select('kind','Annotation',[['note','Text note'],['highlight','Highlight rectangle'],['rectangle','Outline rectangle']])+field('text','Note text','Review note','textarea')+field('pages','Pages (blank means all)','')+field('posX','Left position (%)','12','number')+field('posY','Top position (%)','12','number')+field('markWidth','Width (%)','30','number')+field('markHeight','Height (%)','12','number');
    case 'metadata-edit':return select('action','Change',[['edit','Update specified properties'],['clear','Clear standard properties']])+field('title','Title','')+field('author','Author','')+field('subject','Subject','')+field('keywords','Keywords','');
    case 'images-to-pdf':return select('pageSize','Page size',[['a4','A4'],['letter','US Letter'],['original','Original']])+select('orientation','Orientation',[['auto','Auto'],['portrait','Portrait'],['landscape','Landscape']])+field('margin','Margin (pt)','24','number');
    case 'forms':return field('values','AcroForm values (JSON)','{}','textarea')+`<label class="df2-check"><input type="checkbox" name="flatten"> Flatten the filled fields</label>`;
    default:return '';
  }
}
function readOptions(form:HTMLFormElement):Record<string,unknown>{
  const result:Record<string,unknown>={};
  for(const [key,value] of new FormData(form).entries())result[key]=value;
  form.querySelectorAll<HTMLInputElement>('input[type=number]').forEach(input=>{if(input.value)result[input.name]=Number(input.value)});
  form.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(input=>{result[input.name]=input.checked});
  return result;
}
function range(pages:Iterable<number>):string{
  const nums=[...new Set(pages)].sort((a,b)=>a-b);if(!nums.length)return '';
  const parts:string[]=[];let start=nums[0]!,last=start;
  for(const p of nums.slice(1)){if(p===last+1)last=p;else{parts.push(start===last?String(start):start+'-'+last);start=last=p;}}
  parts.push(start===last?String(start):start+'-'+last);
  return parts.join(',');
}
class DocFlowV2 {
  private files:File[]=[];
  private result:OperationResult|null=null;
  private links:string[]=[];
  private selected=new Set<number>();
  private preview:PreviewController|null=null;
  private organizer:PageOrganizer|null=null;
  private imagePreview:V2ImagePreview|null=null;
  private thumbnailRail:ThumbnailRail|null=null;
  private editor:V2PageEditor|null=null;
  private reader:V2Reader|null=null;
  private nativePreviewSource:ArrayBuffer|null=null;
  private nativePreviewKey='null';
  private nativeGeneration=0;
  private nativeOperation:RunningOperation|null=null;
  private nativePreviewBusy=false;
  private review:ReviewData|null=null;
  private disposeReview:(()=>void)|null=null;
  private processingGeneration=0;
  private renderId=0;
  private currentPage=1;
  private zoom=1;
  private fitMode:'width'|'page'='width';
  private activeFile=0;
  private editorDraft=createEditorDraft();
  private organizerDraft=createOrganizerDraft();
  private optionValues:Record<string,string|boolean>={};
  private lastRouteHash=location.hash||'#/';
  private navigationGeneration=0;
  private busy=false;
  private cancel:()=>void=()=>{};
  private filter='all';
  private search='';
  private tool:V2Tool|null=null;
  private stage:Stage='upload';

  constructor(private readonly root:HTMLDivElement){
    window.addEventListener('hashchange',()=>void this.navigate());
    this.root.addEventListener('click',event=>void this.click(event));
    this.root.addEventListener('input',event=>this.onInput(event));
    this.root.addEventListener('change',()=>this.invalidateResult());
    this.root.addEventListener('df2-draft-change',event=>{this.invalidateResult();if(this.tool?.id==='edit-pdf'&&this.stage==='work')void this.syncNativePreview((event as CustomEvent<{preview?:ArrayBuffer}>).detail?.preview);});
    window.addEventListener('beforeunload',event=>{if(this.files.length){event.preventDefault();event.returnValue='';}});
    window.addEventListener('keydown',event=>{
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){
        event.preventDefault();
        this.openSearch();
      }
      if(event.key==='Escape')this.closeOptions();
    });
    void this.navigate();
  }
  private header():string {
    return `<a class="df2-skip" href="#df2-main">Skip to content</a>
      <header class="df2-header">
        <div class="df2-header-inside">
          <a class="df2-brand" href="#/" aria-label="DocFlow home">
            <span class="df2-brand-logo" aria-hidden="true"><i></i><b></b><em></em></span>
            <span>docflow<span class="df2-brand-period">.</span></span>
          </a>
          <nav class="df2-nav" aria-label="Main navigation">
            <a href="#/"><span>All tools</span></a><a href="#/tools/merge">Merge PDF</a><a href="#/tools/split">Split PDF</a>
          </nav>
          <span class="df2-version">NEW EXPERIENCE · 2.0 PREVIEW</span>
          <button class="df2-iconbutton" data-open-search aria-label="Search PDF tools" title="Search PDF tools">⌕</button>
        </div>
      </header>`;
  }
  private card(tool:V2Tool):string {
    const active=tool.readiness==='active';
    return `<article class="df2-toolcard ${active?'':'df2-coming'}" data-tool-category="${esc(tool.category)}">
      <a href="${active?base+tool.id:'#/'}" data-card-tool="${tool.id}" aria-label="${esc(tool.name)}${active?'':', rebuilding'}">
        <span class="df2-toolicon" aria-hidden="true">${esc(tool.icon)}</span>
        <span class="df2-toolname">${esc(tool.name)}</span>
        <span class="df2-tooldesc">${esc(tool.description)}</span>
        <span class="df2-cardfoot">${active?'<span>Start tool <span aria-hidden="true">↗</span></span>':'<span>Being rebuilt</span>'}</span>
      </a>
    </article>`;
  }
  private home():void {
    const matches=v2Tools.filter(tool=>{
      if(this.filter!=='all'&&this.filter!==tool.category)return false;
      const term=this.search.trim().toLowerCase();
      return !term||[tool.name,tool.description,tool.category].some(t=>t.toLowerCase().includes(term));
    });
    this.root.innerHTML=this.header()+`<main id="df2-main" class="df2-home">
      <section class="df2-hero"><div class="df2-hero-copy">
        <div class="df2-overline"><span class="df2-pulse"></span> THE PDF WORKSPACE, REIMAGINED</div>
        <h1>Every document.<br><em>Handled beautifully.</em></h1>
        <p>Bring everything together, make precise changes, and finish with confidence. The simplest path from file to finished.</p>
        <div class="df2-hero-actions">
          <a class="df2-btn df2-btn-main" href="#/tools/merge">Merge your PDFs <span aria-hidden="true">↗</span></a>
          <a class="df2-btn df2-btn-outline" href="#df2-catalog">Explore tools <span aria-hidden="true">↓</span></a>
        </div><div class="df2-quick-tools" aria-label="Popular PDF tools">${v2Tools.filter(t=>t.featured).map(t=>`<a href="${base+t.id}">${esc(t.name)}</a>`).join('')}</div>
      </div><div class="df2-hero-visual" aria-hidden="true">
        <div class="df2-sheet df2-sheet-back"><div class="df2-sheet-lines"></div></div>
        <div class="df2-sheet df2-sheet-front"><span class="df2-sheet-tag">YOUR DOCUMENT</span><div class="df2-sheet-heading"></div>
          <div class="df2-sheet-line short"></div><div class="df2-sheet-line"></div><div class="df2-sheet-line"></div><div class="df2-sheet-line medium"></div>
          <div class="df2-sheet-graph"><i></i><i></i><i></i><i></i><i></i></div>
          <div class="df2-sheet-line medium"></div><div class="df2-sheet-line short"></div>
        </div><div class="df2-floating df2-floating-one">✓ &nbsp;Ready to export</div>
        <div class="df2-floating df2-floating-two"><b>⇄</b> &nbsp;Merge documents</div>
      </div></section>
      <section class="df2-browse" id="df2-catalog" aria-labelledby="df2-browse-title">
        <div class="df2-section-intro"><div><p class="df2-overline">YOUR TOOLKIT</p><h2 id="df2-browse-title">What do you need to do?</h2></div><span>Find your tool and get started</span></div>
        <div class="df2-searchbox"><span aria-hidden="true">⌕</span><input type="search" data-tool-search value="${esc(this.search)}" placeholder="Search tools — merge, sign, compress, convert…" aria-label="Search PDF tools"><span class="df2-search-hint">⌘ K</span></div>
        <div class="df2-filters" role="group" aria-label="Tool categories">${groups.map(group=>`<button type="button" data-category="${group.id}" aria-pressed="${String(this.filter===group.id)}">${esc(group.label)}</button>`).join('')}</div>
        <div class="df2-catalog-status" aria-live="polite">${matches.length} tools shown · ${activeTools.length} connected to the new workspace</div>
        <div class="df2-toolgrid">${matches.map(t=>this.card(t)).join('')}</div>
        ${matches.length?'':'<p class="df2-empty">No matching tools. Try a broader search.</p>'}
      </section>
      <section class="df2-principles"><span>01 <b>Choose a tool</b></span><i></i><span>02 <b>Work with your document</b></span><i></i><span>03 <b>Download the result</b></span></section>
    </main><footer class="df2-footer"><span>docflow. &nbsp; Precision made simple.</span><span>Clean-slate product preview · Some tools are still being rebuilt</span></footer>`;
    const input=this.root.querySelector<HTMLInputElement>('[data-tool-search]');
    input?.setSelectionRange(this.search.length,this.search.length);
  }
  private async navigate():Promise<void> {
    const requestedHash=location.hash;
    const next=route();
    if(next.id!==(this.tool?.id??null)&&this.files.length&&!window.confirm('Leave this document? Your current files and edits will be discarded.')){
      history.replaceState(null,'',this.lastRouteHash);return;
    }
    const navigation=++this.navigationGeneration;
    ++this.nativeGeneration;this.nativeOperation?.cancel();this.nativeOperation=null;this.nativePreviewBusy=false;
    this.captureOptions();
    if(this.busy){
      // Route changes cancel processing. A generation token prevents stale
      // asynchronous results from returning the user to the previous tool.
      this.processingGeneration++;
      this.cancel();this.busy=false;
    }
    const changedTool=next.id!==(this.tool?.id??null);
    this.organizer?.dispose();this.organizer=null;this.imagePreview?.dispose();this.imagePreview=null;
    this.thumbnailRail?.dispose();this.thumbnailRail=null;this.editor?.dispose();this.editor=null;
    await this.freePreview();
    if(navigation!==this.navigationGeneration||location.hash!==requestedHash)return;
    this.disposeReview?.();this.disposeReview=null;
    if(changedTool){this.files=[];this.resetDraft();}
    this.tool=next.id?getTool(next.id)??null:null;
    this.stage=next.stage;
    if(!this.tool){this.lastRouteHash=location.hash||'#/';this.home();return;}
    if(this.tool.readiness!=='active'){this.lastRouteHash=location.hash||'#/';this.unavailable();return;}
    if(this.stage==='result'&&!this.result)this.stage=this.files.length?'work':'upload';
    if(this.stage==='work'&&!this.files.length)this.stage='upload';
    const canonical=base+this.tool.id+(this.stage==='upload'?'':'/'+this.stage);
    if(location.hash!==canonical)history.replaceState(null,'',canonical);
    this.lastRouteHash=canonical;
    if(this.stage==='upload')this.upload();
    else if(this.stage==='work')this.workspace();
    else this.results();
    const heading=this.root.querySelector<HTMLElement>('h1');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
  }
  private captureOptions():void{
    const form=this.root.querySelector<HTMLFormElement>('[data-options]');
    if(form){this.optionValues=safeOptionValues(form);this.optionValues._advancedOpen=form.querySelector<HTMLDetailsElement>('details')?.open??false;}
  }
  private resetDraft():void{
    // The outgoing form belongs to the discarded document. A following route
    // transition must not capture it back into the new session.
    this.root.querySelector('[data-options]')?.removeAttribute('data-options');
    this.editorDraft=createEditorDraft();this.organizerDraft=createOrganizerDraft();this.optionValues={};
    ++this.nativeGeneration;this.nativeOperation?.cancel();this.nativeOperation=null;this.nativePreviewSource=null;this.nativePreviewKey='null';this.nativePreviewBusy=false;
    this.selected.clear();this.currentPage=1;this.activeFile=0;this.zoom=1;this.result=null;this.review=null;
    this.disposeReview?.();this.disposeReview=null;this.freeLinks();
  }
  private invalidateResult():void{if(this.stage==='work'){this.result=null;this.review=null;this.freeLinks();}}
  private openSearch():void{mountToolSearch(id=>{if(id!==this.tool?.id)location.hash=base+id;});}
  private closeOptions():void{
    const panel=this.root.querySelector<HTMLElement>('[data-options-pane]');
    if(!panel?.classList.contains('opened'))return;
    panel.classList.remove('opened');this.root.querySelector<HTMLButtonElement>('[data-mobile-options]')?.setAttribute('aria-expanded','false');
    this.root.querySelector<HTMLButtonElement>('[data-mobile-options]')?.focus();
  }
  private crumbs():string {
    return `<div class="df2-crumbs"><a href="#/">All tools</a><span aria-hidden="true">›</span><span>${esc(this.tool?.name??'')}</span></div>`;
  }
  private progress():string {
    const number=this.stage==='upload'?1:this.stage==='work'?2:3;
    return `<nav class="df2-progress" aria-label="Tool progress"><span class="${number===1?'active':''}">1 <b>Upload</b></span><i></i><span class="${number===2?'active':''}">2 <b>Work</b></span><i></i><span class="${number===3?'active':''}">3 <b>Download</b></span></nav>`;
  }
  private upload():void {
    const tool=this.tool!;
    this.root.innerHTML=this.header()+`<main id="df2-main" class="df2-tool-route">
      <div class="df2-route-top">${this.crumbs()}${this.progress()}</div>
      <div class="df2-upload-stage">
        <div class="df2-upload-content"><span class="df2-toolicon df2-toolicon-large" aria-hidden="true">${esc(tool.icon)}</span>
          <p class="df2-overline">LET'S GET STARTED</p><h1>${esc(tool.name)}</h1><p>${esc(tool.description)}</p>
          <div class="df2-dropbox" data-dropbox>
            <span class="df2-upload-symbol" aria-hidden="true">↥</span>
            <strong>Drag ${tool.multiple?'your files':'a file'} here</strong><span>or choose from your device</span>
            <label class="df2-btn df2-btn-main">Choose ${tool.multiple?'files':'a file'}<input type="file" data-file-input accept="${tool.accepts}" ${tool.multiple?'multiple':''}></label>
            <small>${tool.accepts.includes('.png')?'JPG or PNG images':'PDF documents'} · 150 MB per file · 250 MB total</small>
          </div><p class="df2-upload-note" role="status" aria-live="polite">Your original files will not be overwritten. You can review the result before downloading.</p>
        </div></div>
    </main>`;
    this.bindDrop();
  }
  private unavailable():void {
    const tool=this.tool!;
    this.root.innerHTML=this.header()+`<main id="df2-main" class="df2-unavailable">${this.crumbs()}<div class="df2-message">
      <span class="df2-toolicon df2-toolicon-large">${esc(tool.icon)}</span>
      <h1>${esc(tool.name)}</h1><p>We're rebuilding this tool as part of DocFlow 2.0. It is not yet connected to a verified processing experience.</p>
      <a href="#/" class="df2-btn df2-btn-main">Explore working tools ↗</a>
    </div></main>`;
  }
  private bindDrop():void {
    const drop=this.root.querySelector<HTMLElement>('[data-dropbox]');
    const input=this.root.querySelector<HTMLInputElement>('[data-file-input]');
    input?.addEventListener('change',()=>{if(input.files)void this.receive([...input.files]);});
    if(!drop)return;
    drop.addEventListener('dragover',event=>{event.preventDefault();drop.classList.add('dragging');});
    drop.addEventListener('dragleave',()=>drop.classList.remove('dragging'));
    drop.addEventListener('drop',event=>{event.preventDefault();drop.classList.remove('dragging');if(event.dataTransfer?.files)void this.receive([...event.dataTransfer.files]);});
  }
  private async receive(files:File[]):Promise<void> {
    const tool=this.tool;if(!tool)return;
    const good=files.filter(file=>tool.accepts.includes('.png')?(/image\/(png|jpeg)/.test(file.type)||/\.(png|jpe?g)$/i.test(file.name)):(file.type==='application/pdf'||/\.pdf$/i.test(file.name)));
    if(good.length!==files.length||!good.length){const el=this.root.querySelector<HTMLElement>('.df2-upload-note');if(el)el.textContent='Choose supported '+(tool.accepts.includes('.png')?'JPG/PNG':'PDF')+' files only.';return;}
    if(this.busy){this.message('Cancel processing before changing files.');return;}
    const candidate=tool.multiple?[...this.files,...good]:good.slice(0,1);
    try{validateInputBudget(candidate.map(file=>file.size));}
    catch(error){
      const note=this.root.querySelector<HTMLElement>('.df2-upload-note');
      const message=error instanceof Error?error.message:'These files exceed the input limit.';
      if(note)note.textContent=message;else this.message(message);
      this.root.querySelectorAll<HTMLInputElement>('[data-file-input],[data-add-file]').forEach(input=>{input.value='';});
      return;
    }
    this.captureOptions();
    if(this.files.length&&!tool.multiple){if(!window.confirm('Replace this document? Your current edits will be discarded.'))return;this.resetDraft();}
    this.files=candidate;
    this.selected.clear();this.currentPage=1;this.result=null;this.review=null;this.disposeReview?.();this.disposeReview=null;
    // One hash-route transition owns the mount; never mount the viewer twice.
    const next=base+tool.id+'/work';
    if(location.hash!==next)location.hash=next;
    else await this.navigate();
  }
  private workspace():void {
    const tool=this.tool!;
    this.organizer?.dispose();this.organizer=null;
    this.imagePreview?.dispose();this.imagePreview=null;
    this.thumbnailRail?.dispose();this.thumbnailRail=null;
    this.editor?.dispose();this.editor=null;
    this.root.innerHTML=this.header()+`<main id="df2-main" class="df2-work ${tool.id==='organize'?'df2-organizing':''}">
      <div class="df2-worktop">${this.crumbs()}<div class="df2-work-actions"><button class="df2-subtle" data-change-files>＋ Add files</button><button class="df2-subtle" data-reset>Start over</button></div></div>
      <div class="df2-workflow">
        <aside class="df2-rail" aria-label="Document pages and files"><div class="df2-pane-title"><strong>${tool.multiple?'Documents':'Pages'}</strong><span>${this.files.length} ${tool.multiple?'files':'file'}</span></div>
          <div class="df2-rail-list">${this.files.map((file,i)=>`<article class="df2-file" data-file-index="${i}"><span class="df2-file-badge">PDF</span><div><b title="${esc(file.name)}">${esc(file.name)}</b><small>${bytes(file.size)}</small></div>
          ${tool.multiple?`<div class="df2-file-actions"><button data-move-up="${i}" aria-label="Move ${esc(file.name)} up" ${i===0?'disabled':''}>↑</button><button data-move-down="${i}" aria-label="Move ${esc(file.name)} down" ${i===this.files.length-1?'disabled':''}>↓</button><button data-remove-file="${i}" aria-label="Remove ${esc(file.name)}">×</button></div>`:''}</article>`).join('')}
          <div class="df2-page-thumbs" aria-label="Page thumbnails"></div></div>
        </aside>
        <section class="df2-canvas-pane" aria-label="Document preview">
          <div class="df2-canvas-toolbar"><span class="df2-doc-name" title="${esc(this.files[0]?.name??'')}">${esc(this.files[0]?.name??'')}</span>
            <div class="df2-zoom"><button data-page-prev aria-label="Previous page">‹</button><span data-page-label>Page 1</span><button data-page-next aria-label="Next page">›</button><span class="df2-zoom-sep"></span><button data-fit aria-label="Fit page or width" title="Switch between fit width and fit page">Fit</button><button data-zoom-out aria-label="Zoom out">−</button><span data-zoom-label>${Math.round(this.zoom*100)}%</span><button data-zoom-in aria-label="Zoom in">+</button></div></div>
          <div class="df2-page-stage" tabindex="0" aria-label="Scrollable document">${tool.id==='organize'?'<button class="df2-subtle" data-show-grid hidden>← Back to pages</button><div class="df2-page-plan-mount" data-organizer-host></div>':''}<div class="df2-canvas-paper"><canvas data-page-canvas aria-label="PDF page preview" role="img"></canvas></div>
            <p data-render-status role="status" aria-live="polite">Preparing document preview…</p>${tool.id==='edit-pdf'?'<p data-native-preview-status role="status" aria-live="polite"></p>':''}</div>
        </section>
        <aside class="df2-inspector" id="df2-options" data-options-pane aria-label="Tool settings"><div class="df2-pane-title"><strong>${esc(tool.name)}</strong><button type="button" class="df2-close-options" data-close-options aria-label="Close options">×</button></div>
          <p class="df2-inspector-caption">${esc(tool.description)}</p>
          <form data-options>${toolOptions(tool.id)}</form>
          <div class="df2-inspector-help"><b>Original preserved</b><p>We create a new result. Review it before sharing or distributing.</p></div>
        </aside>
      </div>
      <div class="df2-work-bottom"><div class="df2-run-status" role="status" data-run-status>Ready to process · ${this.files.length} files</div>
        <button class="df2-btn df2-btn-outline" data-cancel-processing aria-label="Cancel processing" hidden>Cancel</button>
        <button class="df2-btn df2-btn-outline df2-mobile-options" aria-controls="df2-options" aria-expanded="false" data-mobile-options>Options</button>
        <button class="df2-btn df2-btn-main" data-run>${tool.id==='preview'?'Download original':'Run '+esc(tool.name)} <span aria-hidden="true">↗</span></button></div>
    <input hidden type="file" data-add-file accept="${tool.accepts}" ${tool.multiple?'multiple':''}>
    </main>`;
    const form=this.root.querySelector<HTMLFormElement>('[data-options]');if(form)restoreOptions(form,this.optionValues);
    const details=form?.querySelector<HTMLDetailsElement>('details');if(details)details.open=this.optionValues._advancedOpen===true;
    const add=this.root.querySelector<HTMLInputElement>('[data-add-file]');
    add?.addEventListener('change',()=>{if(add.files){void this.receive([...add.files]);}});
    this.root.querySelector<HTMLInputElement>('[name=readerPage]')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void this.jumpReaderPage();}});
    void this.loadPreview();
  }
  private async loadPreview():Promise<void> {
    const generation=++this.renderId;
    await this.freePreview(false);
    const file=this.files[this.activeFile]??this.files[0],canvas=this.root.querySelector<HTMLCanvasElement>('[data-page-canvas]'),
      status=this.root.querySelector<HTMLElement>('[data-render-status]');
    if(!file||!canvas||!status)return;
    if(this.tool?.id==='images-to-pdf'){
      const rail=this.root.querySelector<HTMLElement>('.df2-page-thumbs');
      if(rail){
        this.imagePreview=new V2ImagePreview(this.files,canvas,status,rail);
        await this.imagePreview.mount();
        if(generation!==this.renderId)return;
        const label=this.root.querySelector<HTMLElement>('[data-page-label]');
        if(label)label.textContent='Image 1 / '+this.files.length;
      }
      return;
    }
    try {
      if(this.tool?.id==='edit-pdf'&&JSON.stringify(this.editorDraft.history.current.source??null)!==this.nativePreviewKey){
        const source=this.editorDraft.history.current.source;
        const result=source?.edits.length?await this.nativeBytes(source):null;
        if(generation!==this.renderId)return;
        this.nativePreviewSource=result;this.nativePreviewKey=JSON.stringify(source??null);
      }
      const controller=await createPreview(this.tool?.id==='edit-pdf'&&this.nativePreviewSource?this.nativePreviewSource.slice(0):await file.arrayBuffer(),canvas,status);
      if(generation!==this.renderId){await controller.destroy();return;}
      this.preview=controller;
      await this.showPage(this.currentPage);
      if(generation!==this.renderId)return;
      if(this.tool?.id==='preview'){
        const paper=this.root.querySelector<HTMLElement>('.df2-canvas-paper'),readerStatus=this.root.querySelector<HTMLElement>('[data-reader-status]');
        const input=this.root.querySelector<HTMLInputElement>('[name=readerPage]');if(input){input.max=String(controller.pageCount);input.value=String(this.currentPage);}
        if(paper&&readerStatus)this.reader=new V2Reader(canvas,paper,readerStatus);
      }
      if(this.tool?.id==='edit-pdf'){
        const paper=this.root.querySelector<HTMLElement>('.df2-canvas-paper');
        const panel=this.root.querySelector<HTMLElement>('.df2-inspector');
        if(paper&&panel){
          this.message('Inspecting editable PDF page geometry…');
          const editor=await V2PageEditor.mount(paper,canvas,panel,controller,file,this.editorDraft);
          if(generation!==this.renderId){editor.dispose();return;}
          this.editor=editor;
          this.editor.show(this.currentPage);
          this.message('Ready to edit supported source content or add text, images and PDF annotations');
          const nativeStatus=this.root.querySelector<HTMLElement>('[data-native-preview-status]');if(nativeStatus&&this.editorDraft.history.current.source?.edits.length)nativeStatus.textContent='Source changes previewed';
        }
      }
      if(this.tool?.id==='organize'){
        const host=this.root.querySelector<HTMLElement>('[data-organizer-host]');
        if(host)this.organizer=mountPageOrganizer(host,controller.pageCount,page=>{this.root.querySelector('.df2-work')?.classList.add('df2-page-preview');this.root.querySelector<HTMLButtonElement>('[data-show-grid]')!.hidden=false;void this.showPage(page);},this.organizerDraft,controller);
      }
      const host=this.root.querySelector<HTMLElement>('.df2-page-thumbs');
      if(host && generation===this.renderId){
        this.thumbnailRail=mountPdfThumbnailRail(host,controller);
        host.querySelectorAll<HTMLButtonElement>('.df2-thumb').forEach(btn=>btn.setAttribute('aria-pressed',String(this.selected.has(Number(btn.dataset.page)))));
      }
    }catch(error){if(generation===this.renderId&&status)status.textContent=error instanceof Error?error.message:'Preview unavailable';}
  }
  private async nativeBytes(source:NativeEditPlan):Promise<ArrayBuffer>{
    const file=this.files[0];if(!file)throw Error('Choose a PDF first.');
    this.nativeOperation=runWorkerOperation('native-edit-preview',[{name:file.name,type:'application/pdf',buffer:await file.arrayBuffer()}],{source},()=>{});
    return (await this.nativeOperation.result).outputs[0]!.buffer;
  }
  private async syncNativePreview(provided?:ArrayBuffer):Promise<void>{
    const source=this.editorDraft.history.current.source,key=JSON.stringify(source??null);
    if(key===this.nativePreviewKey)return;
    const generation=++this.nativeGeneration,render=this.renderId,file=this.files[0];
    this.nativeOperation?.cancel();this.nativeOperation=null;this.nativePreviewBusy=true;
    const state=this.root.querySelector<HTMLElement>('[data-native-preview-status]');if(state)state.textContent='Preparing source preview…';
    try{
      const bytes=provided??(source?.edits.length?await this.nativeBytes(source):await file!.arrayBuffer());
      if(generation!==this.nativeGeneration||render!==this.renderId||key!==JSON.stringify(this.editorDraft.history.current.source??null))return;
      this.nativePreviewSource=source?.edits.length?bytes.slice(0):null;this.nativePreviewKey=key;
      const canvas=this.root.querySelector<HTMLCanvasElement>('[data-page-canvas]'),status=this.root.querySelector<HTMLElement>('[data-render-status]');if(!canvas||!status)return;
      this.thumbnailRail?.dispose();this.thumbnailRail=null;
      await this.freePreview(false);if(generation!==this.nativeGeneration||render!==this.renderId)return;
      const controller=await createPreview(bytes.slice(0),canvas,status);
      if(generation!==this.nativeGeneration||render!==this.renderId){await controller.destroy();return;}
      this.preview=controller;await this.showPage(this.currentPage);
      if(generation!==this.nativeGeneration||render!==this.renderId)return;
      const host=this.root.querySelector<HTMLElement>('.df2-page-thumbs');if(host)this.thumbnailRail=mountPdfThumbnailRail(host,controller);
      if(state)state.textContent='Source changes previewed';
    }catch(e){if(generation===this.nativeGeneration){if(state)state.textContent=e instanceof Error?e.message:'Source preview failed.';this.nativePreviewKey='';}}
    finally{if(generation===this.nativeGeneration){this.nativeOperation=null;this.nativePreviewBusy=false;}}
  }
  private async showPage(page:number):Promise<void> {
    const controller=this.preview;if(!controller)return;
    this.reader?.clear();
    this.currentPage=Math.max(1,Math.min(page,controller.pageCount));
    const pageInput=this.root.querySelector<HTMLInputElement>('[name=readerPage]');if(pageInput)pageInput.value=String(this.currentPage);
    const label=this.root.querySelector<HTMLElement>('[data-page-label]');
    if(label)label.textContent='Page '+this.currentPage+' / '+controller.pageCount;
    const zoom=this.root.querySelector<HTMLElement>('[data-zoom-label]');if(zoom)zoom.textContent=Math.round(this.zoom*100)+'%';
    const pdfPage=await controller.document.getPage(this.currentPage),pageSize=pdfPage.getViewport({scale:1});
    if(controller!==this.preview)return;
    const stage=this.root.querySelector<HTMLElement>('.df2-page-stage');
    const width=Math.max(100,(stage?.clientWidth??700)-32),height=Math.max(100,(stage?.clientHeight??800)-32);
    const fit=this.fitMode==='page'?Math.min(width/pageSize.width,height/pageSize.height):width/pageSize.width;
    await controller.render(this.currentPage,Math.max(.1,Math.min(4,fit*this.zoom)));
    this.editor?.show(this.currentPage);
  }
  private async freePreview(invalidate=true):Promise<void> {
    if(invalidate)++this.renderId;
    this.reader?.dispose();this.reader=null;
    const current=this.preview;this.preview=null;
    if(current)await current.destroy().catch(()=>{});
  }
  private freeLinks():void{this.links.forEach(url=>URL.revokeObjectURL(url));this.links=[];}
  private results():void {
    const tool=this.tool!,value=this.result;
    if(!value){this.workspace();return;}
    this.disposeReview?.();this.disposeReview=null;
    this.freeLinks();
    const downloads=value.outputs.map(output=>{
      const url=URL.createObjectURL(new Blob([output.buffer],{type:output.type}));this.links.push(url);
      return `<a class="df2-output" href="${url}" download="${esc(output.name)}"><span class="df2-output-icon">↓</span><span><b>${esc(output.name)}</b><small>${bytes(output.buffer.byteLength)} · Ready to download</small></span><strong>Download →</strong></a>`;
    }).join('');
    const compression=tool.id==='compress'?compressionSummary(value.info):null;
    const compressionMarkup=compression?`<section class="df2-compression-summary" data-compression-summary aria-label="Compression results"><strong>${compression.savedBytes>0?compression.percent+'% smaller':'No size reduction'}</strong><p>Original ${bytes(compression.input)} → Result ${bytes(compression.output)}</p><p>${compression.recompressed} of ${compression.eligible} eligible JPEG images recompressed. Text and vector objects preserved.</p>${compression.savedBytes?'':'<p>This document may already be optimised or use unsupported image encodings. Your original is available below.</p>'}</section>`:'';
    const warning=value.info?.warning?`<p class="df2-review-warning" role="status">${esc(String(value.info.warning))}</p>`:'';
    this.root.innerHTML=this.header()+`<main id="df2-main" class="df2-result">${this.crumbs()}${this.progress()}
      <div class="df2-result-card"><span class="df2-result-check" aria-hidden="true">✓</span><p class="df2-overline">DOCUMENT READY</p>
        <h1>${this.review?.kind==='images'?'Your images are ready.':this.review?'Your analysis is ready.':'Your document is ready.'}</h1><p>${this.review?.kind==='images'?'Review each extracted image below. Download a PNG or the complete ZIP archive.':this.review?'Review the findings below and download the detailed reports.': 'Your original file has not been overwritten.'}</p>
        ${warning}${compressionMarkup}
        <div class="df2-downloads">${downloads||'<p>No downloadable file for this inspection operation.</p>'}</div>
        ${this.review?'<div data-v2-review-container></div>':''}
        ${value.info?`<details class="df2-result-info"><summary>Processing details</summary><pre>${esc(JSON.stringify(value.info,null,2))}</pre></details>`:''}
        <div class="df2-result-actions"><button class="df2-btn df2-btn-outline" data-return-edit>Return to editing</button><button class="df2-btn df2-btn-outline" data-again>Start another file</button><a class="df2-btn df2-btn-subtle" href="#/">See all tools →</a></div>
      </div></main>`;
    if(compression&&!compression.savedBytes&&this.files[0]){
      const source=document.createElement('a');const url=URL.createObjectURL(this.files[0]);this.links.push(url);
      source.href=url;source.download=this.files[0].name;source.className='df2-btn df2-btn-outline';source.textContent='Download original';
      this.root.querySelector('.df2-downloads')?.append(source);
    }
    if(this.review){
      const host=this.root.querySelector<HTMLElement>('[data-v2-review-container]');
      if(host)this.disposeReview=mountReview(host,this.review);
    }
  }
  private async execute():Promise<void>{
    const tool=this.tool;
    if(this.busy||!tool||(!tool.operation&&!['preview','pdf-to-images','extract-images','text-search','compare','protect-pdf','unlock-pdf','repair-pdf'].includes(tool.id))||!this.files.length)return;
    if(tool.id==='merge'&&this.files.length<2){this.message('Choose at least two PDFs to merge.');return;}
    if(tool.id==='compare'&&this.files.length!==2){this.message('Choose exactly two PDFs, A then B, to compare.');return;}
    const form=this.root.querySelector<HTMLFormElement>('[data-options]');
    if(!form)return;
    const options=readOptions(form);
    if(['protect-pdf','unlock-pdf'].includes(tool.id)){
      const password=String(options.securityPassword??'');
      const length=new TextEncoder().encode(password).byteLength;
      if(!password){this.message('Enter the PDF password.');return;}
      if(length>127||(tool.id==='protect-pdf'&&length<8)){
        this.message('Password must use '+(tool.id==='protect-pdf'?'8–127':'1–127')+' UTF-8 bytes.');return;
      }
      if(tool.id==='protect-pdf'&&String(options.confirmPassword??'')!==password){
        this.message('The confirmation password does not match.');return;
      }
    }
    this.disposeReview?.();this.disposeReview=null;this.review=null;
    if(tool.id==='edit-pdf'){
      if(!this.editor){this.message('Wait for the document editor to finish loading.');return;}
      if(this.editor.nativeBusy||this.nativePreviewBusy){this.message('Wait for the source change and preview to finish.');return;}
      if(this.editor.hasPendingSource){this.message('Apply or discard unapplied source text before exporting.');return;}
      options.plan=this.editor.currentPlan;
    }
    if(tool.id==='organize'){
      if(!this.organizer){this.message('Wait for the page preview to finish loading.');return;}
      options.order=this.organizer.getOrder().join(',');
    }
    if(tool.id==='compress'){
      Object.assign(options,compressionSettings(options));
    }
    if(['remove-pages','extract-pages'].includes(tool.id)&&!String(options.pages??'').trim()){
      this.message('Select at least one page before continuing.');return;
    }
    const button=this.root.querySelector<HTMLButtonElement>('[data-run]');
    const generation=++this.processingGeneration;
    this.setProcessing(true);this.message('Preparing files…');
    const progressMessage=(message:string)=>{if(generation===this.processingGeneration)this.message(message);};
    try{
      const input=await Promise.all(this.files.map(async f=>({name:f.name,type:f.type,buffer:await f.arrayBuffer()})));
      if(tool.id==='edit-pdf' && this.editor?.containsText){
        const response=await fetch(`${import.meta.env.BASE_URL}fonts/DocFlowSans.woff`);
        if(!response.ok)throw Error('Editor font unavailable. Reconnect and retry.');
        input.push({name:'DocFlowSans.woff',type:'font/ttf',buffer:await response.arrayBuffer()});
      }
      if(generation!==this.processingGeneration)return;
      let result:OperationResult;
      if(tool.id==='preview'){
        result={outputs:[{name:this.files[0]!.name,type:'application/pdf',buffer:input[0]!.buffer}],info:{originalBytesUnchanged:true,pageCount:this.preview?.pageCount??0}};
      }else if(tool.id==='text-search'){
        let cancelled=false;
        this.cancel=()=>{cancelled=true;};
        const query=String(options.query??'').trim();
        const extracted=await extractAndSearchText(input[0]!.buffer,query,
          (done,total)=>progressMessage('Reading page '+done+' of '+total+' · '+Math.round(done*100/Math.max(1,total))+'%'),
          ()=>cancelled||generation!==this.processingGeneration);
        if(cancelled||generation!==this.processingGeneration)return;
        result=extracted.result;
        this.review={kind:'text',query,hits:extracted.hits,pageCount:extracted.pageCount,scannedPages:extracted.scannedPages};
      }else if(tool.id==='extract-images'){
        let cancelled=false;this.cancel=()=>{cancelled=true;};
        const extracted=await extractEmbeddedImages(input[0]!.buffer,(message,percent)=>progressMessage(message+' · '+Math.round(percent)+'%'),()=>cancelled||generation!==this.processingGeneration);
        if(cancelled||generation!==this.processingGeneration)return;
        const buffer=await extracted.blob.arrayBuffer();
        if(cancelled||generation!==this.processingGeneration)return;
        this.review={kind:'images',images:extracted.images,skipped:extracted.skipped};
        result={outputs:[{name:'embedded-images.zip',type:'application/zip',buffer}],info:{extractedImages:extracted.count,skippedRasterOperations:extracted.skipped.length,format:'Decoded PNG; original compressed streams are not preserved'}};
      }else if(tool.id==='compare'){
        let cancelled=false;
        this.cancel=()=>{cancelled=true;};
        const comparison=await comparePdfs(input[0]!.buffer,input[1]!.buffer,
          {mode:options.mode==='text'||options.mode==='visual'?options.mode:'both',
           maxPages:Number(options.maxPages??20)},
          (done,total)=>progressMessage('Comparing page pair '+done+' of '+total+' · '+Math.round(done*100/Math.max(1,total))+'%'),
          ()=>cancelled||generation!==this.processingGeneration);
        if(cancelled||generation!==this.processingGeneration)return;
        this.review={kind:'compare',comparison};
        const outputs=await Promise.all([
          comparison.report.arrayBuffer().then(buffer=>({name:'comparison-report.txt',type:'text/plain',buffer})),
          comparison.htmlReport.arrayBuffer().then(buffer=>({name:'comparison-report.html',type:'text/html',buffer}))
        ]);
        result={outputs,info:{leftPages:comparison.leftPages,rightPages:comparison.rightPages,
          pagesCompared:comparison.pagesCompared,changedPages:comparison.changedPages,limited:comparison.limited}};
      }else if(['protect-pdf','unlock-pdf','repair-pdf'].includes(tool.id)){
        const operation=tool.id==='protect-pdf'?'protect':tool.id==='unlock-pdf'?'unlock':'repair';
        const password=operation==='repair'?'':String(options.securityPassword??'');
        const running=runQpdfOperation(operation,input[0]!,password,p=>progressMessage(p.message+' · '+p.percent+'%'));
        this.cancel=running.cancel;
        result=await running.result;
      }else if(tool.id==='pdf-to-images'){
        let cancelled=false;
        this.cancel=()=>{cancelled=true;};
        const format=options.format==='jpeg'?'jpeg':'png';
        const scale=Number(options.scale??1.5);
        const blob=await pdfToImages(input[0]!.buffer,format,Number.isFinite(scale)?scale:1.5,
          (done,total)=>progressMessage('Rendering page '+done+' of '+total+' · '+Math.round(done*100/Math.max(1,total))+'%'),
          ()=>cancelled||generation!==this.processingGeneration);
        result={outputs:[{name:'pdf-pages.zip',type:'application/zip',buffer:await blob.arrayBuffer()}],
          info:{format,pageCount:this.preview?.pageCount??0}};
      }else{
        const operation=tool.operation as WorkerOperation;
        const running=runWorkerOperation(operation,input,options,p=>progressMessage(p.message+' · '+p.percent+'%'));
        this.cancel=running.cancel;
        result=await running.result;
      }
      if(generation!==this.processingGeneration)return;
      this.result=result;
      this.busy=false;
      this.cancel=()=>{};
      // Hashchange is the single authority for transition to result stage.
      location.hash=base+tool.id+'/result';
    }catch(error){if(generation===this.processingGeneration)this.message(error instanceof Error?'Could not finish: '+error.message:'Processing failed.');}
    finally {if(generation===this.processingGeneration){this.setProcessing(false);if(button)button.disabled=false;this.cancel=()=>{};}}
  }
  private setProcessing(value:boolean):void{
    this.busy=value;
    const run=this.root.querySelector<HTMLButtonElement>('[data-run]');if(run)run.disabled=value;
    const cancel=this.root.querySelector<HTMLButtonElement>('[data-cancel-processing]');if(cancel)cancel.hidden=!value;
    const content=this.root.querySelector<HTMLElement>('.df2-workflow');if(content)content.inert=value;
  }
  private message(value:string):void{const node=this.root.querySelector<HTMLElement>('[data-run-status]');if(node)node.textContent=value;}
  private onInput(event:Event):void {
    const target=event.target;
    if(target instanceof HTMLInputElement&&target.hasAttribute('data-tool-search')){
      const start=target.selectionStart??target.value.length;
      this.search=target.value;
      const catalog=this.root.querySelector<HTMLElement>('.df2-toolgrid'),status=this.root.querySelector<HTMLElement>('.df2-catalog-status');
      const matches=v2Tools.filter(tool=>(this.filter==='all'||this.filter===tool.category)&&[tool.name,tool.description,tool.category].some(v=>v.toLowerCase().includes(this.search.toLowerCase())));
      if(catalog)catalog.innerHTML=matches.map(tool=>this.card(tool)).join('');
      if(status)status.textContent=matches.length+' matching tools';
      target.setSelectionRange(start,start);
      return;
    }
    if(target instanceof HTMLSelectElement&&target.name==='compressionPreset'){
      const preset=compressionPresets[target.value];
      const form=target.form;if(preset&&form){form.querySelector<HTMLInputElement>('[name=jpegQuality]')!.value=String(Math.round(preset.imageQuality*100));form.querySelector<HTMLInputElement>('[name=maxImagePixels]')!.value=String(preset.maxImageDimension);}
    }
    if(target instanceof HTMLInputElement&&['jpegQuality','maxImagePixels'].includes(target.name)){
      const preset=target.form?.querySelector<HTMLSelectElement>('[name=compressionPreset]');if(preset)preset.value='custom';
    }
    this.invalidateResult();
  }
  private async jumpReaderPage():Promise<void>{
    const input=this.root.querySelector<HTMLInputElement>('[name=readerPage]'),status=this.root.querySelector<HTMLElement>('[data-reader-status]');if(!input||!status)return;
    const page=Number(input.value),count=this.preview?.pageCount;
    if(!count){status.textContent='Wait for the document preview to finish loading.';return;}
    if(!Number.isInteger(page)||page<1||page>count){input.setAttribute('aria-invalid','true');status.textContent='Choose a page from 1–'+count+'.';return;}
    input.removeAttribute('aria-invalid');await this.showPage(page);
  }
  private syncImageLabel():void{
    if(!this.imagePreview)return;
    const label=this.root.querySelector<HTMLElement>('[data-page-label]');
    if(label)label.textContent=this.root.querySelector<HTMLElement>('[data-render-status]')?.textContent??'Image preview';
  }
  private async click(event:MouseEvent):Promise<void>{
    const target=event.target instanceof Element?event.target:null;
    if(!target)return;
    if(target.closest('.df2-skip')){event.preventDefault();const main=this.root.querySelector<HTMLElement>('main');if(main){main.tabIndex=-1;main.focus();}return;}
    if(target.closest('a[href="#df2-catalog"]')){event.preventDefault();this.root.querySelector('#df2-catalog')?.scrollIntoView({behavior:'smooth'});return;}
    const category=target.closest<HTMLElement>('[data-category]');
    if(category){this.filter=category.dataset.category??'all';this.home();return;}
    if(target.closest('[data-open-search]')){this.openSearch();return;}
    if(target.closest('[data-cancel-processing]')){++this.processingGeneration;this.cancel();this.cancel=()=>{};this.setProcessing(false);this.message('Cancelled · your document and settings are ready to use.');return;}
    const t=target.closest<HTMLElement>('[data-card-tool]');
    if(t&&getTool(t.dataset.cardTool??'')?.readiness!=='active'){event.preventDefault();const tool=getTool(t.dataset.cardTool??'');if(tool){this.tool=tool;this.unavailable();}return;}
    if(target.closest('[data-return-edit]')){location.hash=base+this.tool!.id+'/work';return;}
    if(target.closest('[data-show-grid]')){this.root.querySelector('.df2-work')?.classList.remove('df2-page-preview');this.root.querySelector<HTMLButtonElement>('[data-show-grid]')!.hidden=true;return;}
    if(target.closest('[data-reset],[data-again]')){if(this.stage==='work'&&this.files.length&&!window.confirm('Start over? Your current files and edits will be discarded.'))return;this.files=[];this.resetDraft();if(this.tool)location.hash=base+this.tool.id;else location.hash='#/';return;}
    if(target.closest('[data-change-files]')){this.root.querySelector<HTMLInputElement>('[data-add-file]')?.click();return;}
    const up=target.closest<HTMLElement>('[data-move-up]'),down=target.closest<HTMLElement>('[data-move-down]'),remove=target.closest<HTMLElement>('[data-remove-file]');
    if(up||down||remove){const index=Number((up??down??remove)?.dataset.moveUp??(down??remove)?.dataset.moveDown??remove?.dataset.removeFile);
      if(!Number.isInteger(index)||index<0||index>=this.files.length)return;
      this.captureOptions();this.invalidateResult();
      if(remove)this.files.splice(index,1);
      else {const next=index+(up?-1:1);if(next<0||next>=this.files.length)return;[this.files[index],this.files[next]]=[this.files[next]!,this.files[index]!];}
      if(!this.files.length){location.hash=base+this.tool!.id;return;}
      this.workspace();return;
    }
    const thumb=target.closest<HTMLElement>('[data-page]');
    if(thumb&&thumb.classList.contains('df2-thumb')){
      const p=Number(thumb.dataset.page);const pagesField=this.root.querySelector<HTMLInputElement>('input[name="pages"]');
      if(pagesField){if(this.selected.has(p))this.selected.delete(p);else this.selected.add(p);pagesField.value=range(this.selected);this.invalidateResult();}
      this.root.querySelectorAll<HTMLButtonElement>('.df2-thumb').forEach(btn=>btn.setAttribute('aria-pressed',String(this.selected.has(Number(btn.dataset.page)))));
      await this.showPage(p);return;
    }
    const imgThumb=target.closest<HTMLElement>('[data-image-index]');
    if(imgThumb&&this.imagePreview){
      await this.imagePreview.show(Number(imgThumb.dataset.imageIndex));
      const label=this.root.querySelector<HTMLElement>('[data-page-label]');
      if(label)label.textContent=this.root.querySelector<HTMLElement>('[data-render-status]')?.textContent??'Image preview';
      return;
    }
    if(target.closest('[data-reader-go]')){await this.jumpReaderPage();return;}
    if(target.closest('[data-page-prev]')){if(this.imagePreview)await this.imagePreview.next(-1);else await this.showPage(this.currentPage-1);this.syncImageLabel();return;}
    if(target.closest('[data-page-next]')){if(this.imagePreview)await this.imagePreview.next(1);else await this.showPage(this.currentPage+1);this.syncImageLabel();return;}
    if(target.closest('[data-zoom-out]')){this.zoom=Math.max(.55,this.zoom-.15);await this.showPage(this.currentPage);return;}
    if(target.closest('[data-zoom-in]')){this.zoom=Math.min(2.4,this.zoom+.15);await this.showPage(this.currentPage);return;}
    if(target.closest('[data-fit]')){this.fitMode=this.fitMode==='width'?'page':'width';this.zoom=1;await this.showPage(this.currentPage);return;}
    if(target.closest('[data-close-options]')){this.closeOptions();return;}
    if(target.closest('[data-mobile-options]')){const panel=this.root.querySelector<HTMLElement>('[data-options-pane]');if(panel?.classList.contains('opened'))this.closeOptions();else{panel?.classList.add('opened');this.root.querySelector('[data-mobile-options]')?.setAttribute('aria-expanded','true');panel?.querySelector<HTMLElement>('[data-close-options]')?.focus();}return;}
    if(target.closest('[data-run]')){await this.execute();return;}
  }
}
export function mountV2(root:HTMLDivElement|null):void{
  if(!root)throw Error('APP_ROOT_MISSING');
  new DocFlowV2(root);
}
