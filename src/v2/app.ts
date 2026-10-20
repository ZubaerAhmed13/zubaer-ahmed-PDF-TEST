import { runWorkerOperation } from '../pdf/workerClient';
import type { OperationResult, WorkerOperation } from '../pdf/types';
import { createPreview, type PreviewController } from '../pdf/render';
import { activeTools, getTool, groups, v2Tools, type V2Tool } from './catalog';
import { mountPageOrganizer, type PageOrganizer } from './pageOrganizer';
import { V2ImagePreview } from './imagePreview';

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
    case 'organize': return `<div class="df2-page-plan-mount" data-organizer-host></div><p class="df2-organize-warning">Reordering preserves page contents. Duplicated pages may increase file size.</p>`;
    case 'compress': return select('compressionPreset','Image compression',[['balanced','Balanced quality'],['quality','Higher image quality'],['small','Smaller images']])+ `<p class="df2-organize-warning">Recompresses eligible RGB JPEG images only. No compression guarantee for scans using other encodings. Text and vectors stay as PDF objects.</p>`;
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
  private processingGeneration=0;
  private renderId=0;
  private currentPage=1;
  private zoom=1;
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
    window.addEventListener('keydown',event=>{
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){
        event.preventDefault();
        location.hash='#/';
        queueMicrotask(()=>this.root.querySelector<HTMLInputElement>('[data-tool-search]')?.focus());
      }
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
    return `<article class="df2-toolcard ${active?'':'df2-coming'}">
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
        </div><div class="df2-facts"><span>◉ Real PDF operations</span><span>◈ Dedicated workspaces</span><span>✓ Reviewed results</span></div>
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
    if(this.busy){
      // Route changes cancel processing. A generation token prevents stale
      // asynchronous results from returning the user to the previous tool.
      this.processingGeneration++;
      this.cancel();this.busy=false;
    }
    const next=route();
    if(next.id!==this.tool?.id){this.files=[];this.selected.clear();this.result=null;this.freeLinks();this.organizer?.dispose();this.organizer=null;this.imagePreview?.dispose();this.imagePreview=null;await this.freePreview();}
    this.tool=next.id?getTool(next.id)??null:null;
    this.stage=next.stage;
    if(!this.tool){this.home();return;}
    if(this.tool.readiness!=='active'){this.unavailable();return;}
    if(this.stage==='result'&&!this.result)this.stage=this.files.length?'work':'upload';
    if(this.stage==='work'&&!this.files.length)this.stage='upload';
    if(this.stage==='upload')this.upload();
    else if(this.stage==='work')this.workspace();
    else this.results();
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
            <small>${tool.accepts.includes('.png')?'JPG or PNG images':'PDF documents'} · Up to your browser’s available memory</small>
          </div><p class="df2-upload-note">Your original files will not be overwritten. You can review the result before downloading.</p>
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
    this.files=tool.multiple?[...this.files,...good]:good.slice(0,1);
    this.selected.clear();this.currentPage=1;this.result=null;
    // One hash-route transition owns the mount; never mount the viewer twice.
    const next=base+tool.id+'/work';
    if(location.hash!==next)location.hash=next;
    else await this.navigate();
  }
  private workspace():void {
    const tool=this.tool!;
    this.organizer?.dispose();this.organizer=null;
    this.imagePreview?.dispose();this.imagePreview=null;
    this.root.innerHTML=this.header()+`<main id="df2-main" class="df2-work">
      <div class="df2-worktop">${this.crumbs()}<div class="df2-work-actions"><button class="df2-subtle" data-change-files>＋ Add files</button><button class="df2-subtle" data-reset>Start over</button></div></div>
      <div class="df2-workflow">
        <aside class="df2-rail" aria-label="Document pages and files"><div class="df2-pane-title"><strong>${tool.multiple?'Documents':'Pages'}</strong><span>${this.files.length} ${tool.multiple?'files':'file'}</span></div>
          <div class="df2-rail-list">${this.files.map((file,i)=>`<article class="df2-file" data-file-index="${i}"><span class="df2-file-badge">PDF</span><div><b title="${esc(file.name)}">${esc(file.name)}</b><small>${bytes(file.size)}</small></div>
          ${tool.multiple?`<div class="df2-file-actions"><button data-move-up="${i}" aria-label="Move ${esc(file.name)} up" ${i===0?'disabled':''}>↑</button><button data-move-down="${i}" aria-label="Move ${esc(file.name)} down" ${i===this.files.length-1?'disabled':''}>↓</button><button data-remove-file="${i}" aria-label="Remove ${esc(file.name)}">×</button></div>`:''}</article>`).join('')}
          <div class="df2-page-thumbs" aria-label="Page thumbnails"></div></div>
        </aside>
        <section class="df2-canvas-pane" aria-label="Document preview">
          <div class="df2-canvas-toolbar"><span class="df2-doc-name" title="${esc(this.files[0]?.name??'')}">${esc(this.files[0]?.name??'')}</span>
            <div class="df2-zoom"><button data-page-prev aria-label="Previous page">‹</button><span data-page-label>Page 1</span><button data-page-next aria-label="Next page">›</button><span class="df2-zoom-sep"></span><button data-zoom-out aria-label="Zoom out">−</button><span data-zoom-label>${Math.round(this.zoom*100)}%</span><button data-zoom-in aria-label="Zoom in">+</button></div></div>
          <div class="df2-page-stage"><div class="df2-canvas-paper"><canvas data-page-canvas aria-label="PDF page preview" role="img"></canvas></div>
            <p data-render-status role="status" aria-live="polite">Preparing document preview…</p></div>
        </section>
        <aside class="df2-inspector" data-options-pane aria-label="Tool settings"><div class="df2-pane-title"><strong>${esc(tool.name)}</strong><span>OPTIONS</span></div>
          <p class="df2-inspector-caption">${esc(tool.description)}</p>
          <form data-options>${toolOptions(tool.id)}</form>
          <div class="df2-inspector-help"><b>Original preserved</b><p>We create a new result. Review it before sharing or distributing.</p></div>
        </aside>
      </div>
      <div class="df2-work-bottom"><div class="df2-run-status" role="status" data-run-status>Ready to process · ${this.files.length} files</div>
        <button class="df2-btn df2-btn-outline df2-mobile-options" data-mobile-options>Options</button>
        <button class="df2-btn df2-btn-main" data-run>Run ${esc(tool.name)} <span aria-hidden="true">↗</span></button></div>
    <input hidden type="file" data-add-file accept="${tool.accepts}" ${tool.multiple?'multiple':''}>
    </main>`;
    const add=this.root.querySelector<HTMLInputElement>('[data-add-file]');
    add?.addEventListener('change',()=>{if(add.files){void this.receive([...add.files]);}});
    void this.loadPreview();
  }
  private async loadPreview():Promise<void> {
    const generation=++this.renderId;
    await this.freePreview(false);
    const file=this.files[0],canvas=this.root.querySelector<HTMLCanvasElement>('[data-page-canvas]'),
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
      const controller=await createPreview(await file.arrayBuffer(),canvas,status);
      if(generation!==this.renderId){await controller.destroy();return;}
      this.preview=controller;
      await this.showPage(1);
      if(this.tool?.id==='organize'){
        const host=this.root.querySelector<HTMLElement>('[data-organizer-host]');
        if(host)this.organizer=mountPageOrganizer(host,controller.pageCount,page=>{void this.showPage(page);});
      }
      const host=this.root.querySelector<HTMLElement>('.df2-page-thumbs');if(!host)return;
      // R0 bounds thumbnail count; R1 adds virtualization for all pages.
      for(let n=1;n<=Math.min(controller.pageCount,16);n++){
        if(generation!==this.renderId)break;
        const btn=document.createElement('button');
        btn.className='df2-thumb';btn.dataset.page=String(n);btn.setAttribute('aria-label','Select page '+n);
        btn.setAttribute('aria-pressed','false');
        const tiny=document.createElement('canvas'),label=document.createElement('span');
        label.textContent='Page '+n;btn.append(tiny,label);host.append(btn);
        try {await controller.renderThumbnail(n,tiny,.18);}catch{label.textContent='Page '+n;}
      }
      if(controller.pageCount>16){const more=document.createElement('p');more.className='df2-rail-note';more.textContent='Showing the first 16 page previews. Use page navigation for the rest.';host.append(more);}
    }catch(error){if(generation===this.renderId&&status)status.textContent=error instanceof Error?error.message:'Preview unavailable';}
  }
  private async showPage(page:number):Promise<void> {
    const controller=this.preview;if(!controller)return;
    this.currentPage=Math.max(1,Math.min(page,controller.pageCount));
    const label=this.root.querySelector<HTMLElement>('[data-page-label]');
    if(label)label.textContent='Page '+this.currentPage+' / '+controller.pageCount;
    const zoom=this.root.querySelector<HTMLElement>('[data-zoom-label]');if(zoom)zoom.textContent=Math.round(this.zoom*100)+'%';
    await controller.render(this.currentPage,1.08*this.zoom);
  }
  private async freePreview(invalidate=true):Promise<void> {
    if(invalidate)++this.renderId;
    const current=this.preview;this.preview=null;
    if(current)await current.destroy().catch(()=>{});
  }
  private freeLinks():void{this.links.forEach(url=>URL.revokeObjectURL(url));this.links=[];}
  private results():void {
    const tool=this.tool!,value=this.result;
    if(!value){this.workspace();return;}
    this.freeLinks();
    const downloads=value.outputs.map(output=>{
      const url=URL.createObjectURL(new Blob([output.buffer],{type:output.type}));this.links.push(url);
      return `<a class="df2-output" href="${url}" download="${esc(output.name)}"><span class="df2-output-icon">↓</span><span><b>${esc(output.name)}</b><small>${bytes(output.buffer.byteLength)} · Ready to download</small></span><strong>Download →</strong></a>`;
    }).join('');
    this.root.innerHTML=this.header()+`<main id="df2-main" class="df2-result">${this.crumbs()}${this.progress()}
      <div class="df2-result-card"><span class="df2-result-check" aria-hidden="true">✓</span><p class="df2-overline">DOCUMENT READY</p>
        <h1>All done. Beautifully simple.</h1><p>Your ${esc(tool.name.toLowerCase())} task finished. Your original file hasn't been overwritten.</p>
        <div class="df2-downloads">${downloads||'<p>No downloadable file for this inspection operation.</p>'}</div>
        ${value.info?`<details class="df2-result-info"><summary>Processing details</summary><pre>${esc(JSON.stringify(value.info,null,2))}</pre></details>`:''}
        <div class="df2-result-actions"><button class="df2-btn df2-btn-outline" data-again>Start another file</button><a class="df2-btn df2-btn-subtle" href="#/">See all tools →</a></div>
      </div></main>`;
  }
  private async execute():Promise<void>{
    if(this.busy||!this.tool?.operation||!this.files.length)return;
    if(this.tool.id==='merge'&&this.files.length<2){this.message('Choose at least two PDFs to merge.');return;}
    const form=this.root.querySelector<HTMLFormElement>('[data-options]');
    if(!form)return;
    const options=readOptions(form);
    if(this.tool.id==='organize'){
      if(!this.organizer){this.message('Wait for the page preview to finish loading.');return;}
      options.order=this.organizer.getOrder().join(',');
    }
    if(this.tool.id==='compress'){
      const preset=String(options.compressionPreset??'balanced');
      const settings=preset==='quality'?{imageQuality:.91,maxImageDimension:3500}:
        preset==='small'?{imageQuality:.61,maxImageDimension:1400}:{imageQuality:.79,maxImageDimension:2200};
      Object.assign(options,settings);
    }
    if(['remove-pages','extract-pages'].includes(this.tool.id)&&!String(options.pages??'').trim()){
      this.message('Select at least one page before continuing.');return;
    }
    const button=this.root.querySelector<HTMLButtonElement>('[data-run]');
    const generation=++this.processingGeneration;
    this.busy=true;if(button)button.disabled=true;this.message('Preparing files…');
    try{
      const input=await Promise.all(this.files.map(async f=>({name:f.name,type:f.type,buffer:await f.arrayBuffer()})));
      const operation=this.tool.operation as WorkerOperation;
      const running=runWorkerOperation(operation,input,options,p=>this.message(p.message+' · '+p.percent+'%'));
      this.cancel=running.cancel;
      const result=await running.result;
      if(generation!==this.processingGeneration)return;
      this.result=result;
      this.busy=false;
      this.cancel=()=>{};
      // Hashchange is the single authority for transition to result stage.
      location.hash=base+this.tool.id+'/result';
    }catch(error){if(generation===this.processingGeneration)this.message(error instanceof Error?'Could not finish: '+error.message:'Processing failed.');}
    finally {if(generation===this.processingGeneration){this.busy=false;if(button)button.disabled=false;this.cancel=()=>{};}}
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
    }
  }
  private syncImageLabel():void{
    if(!this.imagePreview)return;
    const label=this.root.querySelector<HTMLElement>('[data-page-label]');
    if(label)label.textContent=this.root.querySelector<HTMLElement>('[data-render-status]')?.textContent??'Image preview';
  }
  private async click(event:MouseEvent):Promise<void>{
    const target=event.target instanceof Element?event.target:null;
    if(!target)return;
    const category=target.closest<HTMLElement>('[data-category]');
    if(category){this.filter=category.dataset.category??'all';this.home();return;}
    if(target.closest('[data-open-search]')){location.hash='#/';queueMicrotask(()=>this.root.querySelector<HTMLInputElement>('[data-tool-search]')?.focus());return;}
    const t=target.closest<HTMLElement>('[data-card-tool]');
    if(t&&getTool(t.dataset.cardTool??'')?.readiness!=='active'){event.preventDefault();const tool=getTool(t.dataset.cardTool??'');if(tool){this.tool=tool;this.unavailable();}return;}
    if(target.closest('[data-reset],[data-again]')){this.files=[];this.selected.clear();this.result=null;this.freeLinks();this.imagePreview?.dispose();this.imagePreview=null;this.organizer?.dispose();this.organizer=null;await this.freePreview();if(this.tool)location.hash=base+this.tool.id;else location.hash='#/';return;}
    if(target.closest('[data-change-files]')){this.root.querySelector<HTMLInputElement>('[data-add-file]')?.click();return;}
    const up=target.closest<HTMLElement>('[data-move-up]'),down=target.closest<HTMLElement>('[data-move-down]'),remove=target.closest<HTMLElement>('[data-remove-file]');
    if(up||down||remove){const index=Number((up??down??remove)?.dataset.moveUp??(down??remove)?.dataset.moveDown??remove?.dataset.removeFile);
      if(!Number.isInteger(index)||index<0||index>=this.files.length)return;
      if(remove)this.files.splice(index,1);
      else {const next=index+(up?-1:1);if(next<0||next>=this.files.length)return;[this.files[index],this.files[next]]=[this.files[next]!,this.files[index]!];}
      if(!this.files.length){location.hash=base+this.tool!.id;return;}
      this.workspace();return;
    }
    const thumb=target.closest<HTMLElement>('[data-page]');
    if(thumb&&thumb.classList.contains('df2-thumb')){
      const p=Number(thumb.dataset.page);const pagesField=this.root.querySelector<HTMLInputElement>('input[name="pages"]');
      if(pagesField){if(this.selected.has(p))this.selected.delete(p);else this.selected.add(p);pagesField.value=range(this.selected);}
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
    if(target.closest('[data-page-prev]')){if(this.imagePreview)await this.imagePreview.next(-1);else await this.showPage(this.currentPage-1);this.syncImageLabel();return;}
    if(target.closest('[data-page-next]')){if(this.imagePreview)await this.imagePreview.next(1);else await this.showPage(this.currentPage+1);this.syncImageLabel();return;}
    if(target.closest('[data-zoom-out]')){this.zoom=Math.max(.55,this.zoom-.15);await this.showPage(this.currentPage);return;}
    if(target.closest('[data-zoom-in]')){this.zoom=Math.min(2.4,this.zoom+.15);await this.showPage(this.currentPage);return;}
    if(target.closest('[data-mobile-options]')){this.root.querySelector<HTMLElement>('[data-options-pane]')?.classList.toggle('opened');return;}
    if(target.closest('[data-run]')){await this.execute();return;}
  }
}
export function mountV2(root:HTMLDivElement|null):void{
  if(!root)throw Error('APP_ROOT_MISSING');
  new DocFlowV2(root);
}
