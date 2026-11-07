import { runWorkerOperation } from '../pdf/workerClient';
import type { OperationResult, OutputFile, WorkerOperation } from '../pdf/types';
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
import {V2Redaction,createRedactionDraft} from './redaction';
import {redactPdf,REDACTION_MAX_BYTES,REDACTION_MAX_PAGES} from '../pdf/secureRasterRedaction';
import {mountSignaturePad} from '../app/signaturePad';
import {typedSignature} from './signature';
import {V2PipelineEditor,createPipelineDraft} from './pipelineEditor';
import {createPipeline,runPipeline,validatePipelineFiles,pipelineSummary,type PipelineReport} from './pipeline';
import {mountPipelineReport} from './pipelineReview';
import {V2FormFiller,createFormDraft} from './forms';
import {scanOptions} from '../pdf/scanProcessing';
import {V2ServerProcessing,serverProcessingAvailable} from './serverProcessing';
import {prepareServerInput,serverSettings} from './serverTools';
import {configureWorkProtection} from '../app/workProtection';
import {openOfflineDialog} from './offlineDialog';
import {WorkspaceHistory,type RevisionDirection} from './workspaceHistory';
import {getFavorites,isFavorite,replaceFavorites,subscribeFavorites,toggleFavorite} from '../app/favoriteStore';
import {sanitizeCloudTools} from '../app/cloudSync';
import {openPreferencesDialog} from './preferencesDialog';
import {mountScanReview,type PhotoCorrections} from '../tools/scanReview';
import {parseRequiredPageSelection,parseSplitRanges} from '../pdf/pageRanges';
import {outputFilename} from '../app/outputFilename';

const esc=(value:string):string=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const bytes=(value:number):string=>value<1024?value+' B':value<1048576?(value/1024).toFixed(1)+' KB':(value/1048576).toFixed(1)+' MB';
const base='#/tools/';
const recentToolsKey='docflow.recent-tools.v1';
const preferenceToolIds=new Set(activeTools.map(tool=>tool.id));
function readRecentTools():string[] {
  try {
    const recentTools:unknown=JSON.parse(localStorage.getItem(recentToolsKey)??'[]');
    return sanitizeCloudTools({recent_tools:recentTools},preferenceToolIds).recent_tools;
  } catch { return []; }
}
type Stage='upload'|'work'|'result';
type Route={id:string|null;stage:Stage};
type ResultHandoff={result:OperationResult;toolId:string;file:File};
type WorkspaceRevision={id:string;stage:'work'|'result';size:number;state:{
  files:File[];result:OperationResult|null;review:ReviewData|null;
  optionValues:Record<string,string|boolean>;
  editorDraft:ReturnType<typeof createEditorDraft>;organizerDraft:ReturnType<typeof createOrganizerDraft>;
  redactionDraft:ReturnType<typeof createRedactionDraft>;formDraft:ReturnType<typeof createFormDraft>;
  signatureInk:string;watermarkImage:File|null;photoCorrections:PhotoCorrections;
  pipelineDraft:ReturnType<typeof createPipelineDraft>;pipelineKind:string|null;pipelineReport:PipelineReport|null;
  selected:Set<number>;currentPage:number;activeFile:number;zoom:number;fitMode:'width'|'page';
}};
type WorkspaceTransition={kind:'handoff';handoff:ResultHandoff}|{kind:'revision';direction:RevisionDirection;revision:WorkspaceRevision};
const clearsHistory=(id:string):boolean=>id==='redact-secure'||id==='protect-pdf';
const visualPageTools=new Set(['split','remove-pages','extract-pages']);
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
    case 'ocr':return (serverProcessingAvailable()?select('processingMode','Processing location',[['device','On this device'],['server','Temporary server processing']]):'')+select('language','Recognition language',[['eng','English'],['deu','German (Deutsch)'],['eng+deu','English + German']])+`<fieldset data-ocr-local data-processing-local class="df2-ocr-local"><legend>On-device recognition</legend>`+field('pages','Pages (blank means all)','')+`<label class="df2-control">Maximum pages per run (1–30)<input name="maxPages" type="number" min="1" max="30" step="1" value="10" required></label><label class="df2-check"><input name="skipExistingText" type="checkbox" checked> Skip pages with existing selectable text</label><details><summary>Recognition preview and corrections</summary>${select('rotation','Recognition rotation',[['0','No rotation'],['90','90° clockwise'],['180','180°'],['270','270° clockwise']])}${field('deskew','Deskew angle (−15° to 15°)','0','number')}${select('cleanup','Recognition cleanup',[['original','Original appearance'],['grayscale','Grayscale'],['contrast','Higher contrast'],['binary','Black and white']])}${field('previewPage','Preview page','1','number')}<button type="button" class="df2-btn df2-btn-outline" data-ocr-preview>Review recognition preview</button><p data-ocr-preview-status role="status" aria-live="polite"></p><div data-ocr-preview-pair></div></details><p class="df2-organize-warning">OCR runs on this device using English/German models served by DocFlow. No document upload. Maximum 40 MB input and 30 selected pages per run. Unprocessed pages stay unchanged; retry them from your original. Corrections affect recognition only; the source scan stays visible. OCR can make mistakes and does not certify accessibility. Adding a text layer invalidates existing digital signatures. Review important names and numbers.</p></fieldset><div data-ocr-server data-processing-server hidden></div>`;
    case 'office-to-pdf':return '<div data-processing-server></div>';
    case 'workflow':case 'batch':return '<div data-pipeline-editor></div>';
    case 'sign-visual':return `<p class="df2-organize-warning">This adds a visible signature mark. It is not a digital certificate or a cryptographic signature. PDFs containing existing certificate signatures are not supported by this tool.</p><div data-signature-pad-host></div><button type="button" class="df2-btn df2-btn-outline" data-signature-place>Place drawing</button><label class="df2-control">Typed signature<input name="signatureText" maxlength="150" autocomplete="off" placeholder="Your name"></label><button type="button" class="df2-btn df2-btn-outline" data-signature-type>Place typed signature</button>`;
    case 'redact-secure':return select('redactionDpi','Raster resolution',[['115.2','Standard · 115 DPI'],['150','Higher detail · 150 DPI'],['200','Higher detail · 200 DPI'],['300','Highest detail · 300 DPI']])+`<p class="df2-organize-warning">Every page becomes an image-only PDF. Original selectable text, accessibility tags, interactive forms, attachments, digital signature validation and metadata are discarded, even on unmarked pages. Unmarked visible content stays as pixels. Output resolution is capped at 3.2 million pixels and 2,200 pixels per dimension. Maximum 15 pages and 40 MB input.</p><label class="df2-check"><input type="checkbox" name="confirmRasterization"> I understand that all pages become images and document structure is removed. I will review the exported PDF.</label>`;
    case 'preview':return `<label class="df2-control">Page number<input type="number" name="readerPage" min="1" step="1" value="1"></label><button type="button" class="df2-btn df2-btn-outline" data-reader-go>Go to page</button><p data-reader-status role="status" aria-live="polite">Preparing text selection…</p><p>Read, zoom and select existing PDF text. Downloading keeps the original bytes. Scanned pages need OCR for selectable text.</p>`;
    case 'extract-images':return `<p class="df2-organize-warning">Extracts supported embedded raster objects as PNGs, retaining their pixel dimensions. Masks and grouped inline atlases are reported as skipped. Vectors are not raster images. Original compressed streams and source metadata are not preserved. Up to 1,000 image records, 16 million pixels per image and 150 MB of encoded images.</p>`;
    case 'protect-pdf': return `<label class="df2-control"><span>New PDF password</span><input type="password" name="securityPassword" autocomplete="new-password" minlength="8" maxlength="127" required></label><label class="df2-control"><span>Confirm password</span><input type="password" name="confirmPassword" autocomplete="new-password" minlength="8" maxlength="127" required></label><p class="df2-organize-warning">AES-256 PDF encryption via qpdf. The password is required to open the resulting PDF. DocFlow cannot recover forgotten passwords.</p>`;
    case 'unlock-pdf': return `<label class="df2-control"><span>PDF password</span><input type="password" name="securityPassword" autocomplete="current-password" maxlength="127" required></label><p class="df2-organize-warning">Only unlock PDFs you are authorised to access. Enter the existing PDF password; qpdf validates it before removing encryption.</p>`;
    case 'repair-pdf': return `<p class="df2-organize-warning">Attempts to recover damaged PDF cross-references and rewrite structure. This cannot reconstruct missing text, images, or irreparably damaged pages.</p>`;
    case 'text-search': return field('query','Search phrase (optional)','')+`<p class="df2-organize-warning">Find text that is already selectable in the PDF and export plain text and Markdown. Scanned pages require OCR. The PDF itself is not modified.</p>`;
    case 'compare': return select('mode','Comparison',[['both','Text + visual'],['text','Text only'],['visual','Visual only']])+select('maxPages','Check first pages',[['10','10 pages'],['20','20 pages'],['35','35 pages'],['50','50 pages']])+`<p class="df2-organize-warning">Upload exactly two PDFs, A then B. Matches are heuristic; visually small edits may not be detected. Reports are for review, not legal certification.</p>`;
    case 'pdf-to-images': return select('format','Image format',[['png','PNG · lossless'],['jpeg','JPG · smaller']])+select('scale','Image resolution',[['1','Standard · 1×'],['1.5','High · 1.5×'],['2','Very high · 2×']])
      +`<label class="df2-control">Pages to export<input name="pages" aria-describedby="df2-image-export-pages" placeholder="All pages"></label>
      <p id="df2-image-export-pages" class="df2-organize-warning">Select thumbnails or enter page ranges like 2, 4-6. A blank field exports every page. Selecting a thumbnail starts a page list.</p>`;
    case 'organize': return `<p class="df2-organize-warning">Arrange page cards in the document area. Reordering preserves page contents. Duplicated pages may increase file size.</p>`;
    case 'compress': return (serverProcessingAvailable()?select('processingMode','Processing location',[['device','On this device'],['server','Temporary server processing']]):'')+'<fieldset data-processing-local class="df2-ocr-local"><legend>On-device compression</legend>'+select('compressionPreset','Image compression',[['balanced','Balanced quality'],['quality','Higher image quality'],['small','Smaller images'],['custom','Custom settings']])+`<details class="df2-compression-details"><summary>Advanced compression</summary><label class="df2-control">JPEG image quality (%)<input name="jpegQuality" type="number" min="50" max="95" step="1" value="79"></label><label class="df2-control">Maximum image dimension (px)<input name="maxImagePixels" type="number" min="900" max="5000" step="1" value="2200"></label><p>Images above this pixel size are downsampled. This is a pixel limit, not DPI. Smaller images and lower quality can reduce detail.</p></details><p class="df2-organize-warning">Recompresses eligible RGB JPEG images while preserving text and vectors. Other encodings are left unchanged. Results depend on the document.</p></fieldset><div data-processing-server hidden></div>`;
    case 'split':return select('mode','Split method',[['selected','Selected pages'],['ranges','Page ranges'],['individual','Individual pages'],['every','Every N pages']])+field('pages','Pages to extract','')+field('ranges','Separate ranges (semicolon)','1-2;3-4')+field('every','Pages in each part','5','number')+select('splitOutput','Output format',[['zip','ZIP archive'],['pdfs','Separate PDFs']]);
    case 'remove-pages':return field('pages','Pages to remove','');
    case 'extract-pages':return field('pages','Pages to extract','');
    case 'rotate':return select('target','Rotate',[['all','All pages'],['odd','Odd pages'],['even','Even pages'],['selected','Selected pages']])+select('degrees','Rotation',[['90','90° clockwise'],['180','180°'],['270','270° clockwise']])+field('pages','Selected pages (when needed)','');
    case 'page-numbers':return field('pages','Pages (blank means all)','')+field('start','Start at','1','number')+select('format','Format',[['page-total','Page 1 of N'],['page','Page 1'],['number','1']])+field('fontSize','Size (points)','11','number')+field('margin','Bottom margin','24','number');
    case 'watermark':return select('watermarkMode','Watermark type',[['text','Text watermark'],['image','Image watermark']])
      +`<label class="df2-control">Opacity (0.05–1)<input name="opacity" type="number" min="0.05" max="1" step="any" value="0.18"></label>
      <fieldset data-watermark-settings="text"><legend>Text settings</legend>${field('text','Watermark text','CONFIDENTIAL')}${field('rotation','Angle','-35','number')}${field('fontSize','Font size','42','number')}</fieldset>
      <fieldset data-watermark-settings="image" hidden><legend>Image settings</legend>
      <label class="df2-control">Watermark image<input type="file" data-watermark-image accept=".png,.jpg,.jpeg,image/png,image/jpeg" aria-describedby="df2-watermark-image-status"></label>
      <p id="df2-watermark-image-status" class="df2-organize-warning" role="status"></p>
      <label class="df2-control">Image width (% of page)<input name="imageWidthPercent" type="number" min="5" max="90" value="25"></label>
      ${select('imagePosition','Image position',[['center','Center'],['top-left','Top left'],['top','Top center'],['top-right','Top right'],['left','Middle left'],['right','Middle right'],['bottom-left','Bottom left'],['bottom','Bottom center'],['bottom-right','Bottom right']])}
      <label class="df2-control">Edge margin (pt)<input name="imageMargin" type="number" min="0" max="240" value="24"></label>
      <label class="df2-control">Image angle<input name="imageRotation" type="number" min="-180" max="180" value="0"></label></fieldset>`;
    case 'crop':return field('pages','Pages (blank means all)','')+field('left','Left margin','24','number')+field('right','Right margin','24','number')+field('top','Top margin','24','number')+field('bottom','Bottom margin','24','number');
    case 'annotate':return select('kind','Annotation',[['note','Text note'],['highlight','Highlight rectangle'],['rectangle','Outline rectangle']])+field('text','Note text','Review note','textarea')+field('pages','Pages (blank means all)','')+field('posX','Left position (%)','12','number')+field('posY','Top position (%)','12','number')+field('markWidth','Width (%)','30','number')+field('markHeight','Height (%)','12','number');
    case 'metadata-edit':return select('action','Change',[['edit','Update specified properties'],['clear','Clear standard properties']])+field('title','Title','')+field('author','Author','')+field('subject','Subject','')+field('keywords','Keywords','');
    case 'images-to-pdf':return select('pageSize','Page size',[['a4','A4'],['letter','US Letter'],['original','Original']])
      +select('orientation','Orientation',[['auto','Auto'],['portrait','Portrait'],['landscape','Landscape']])+field('margin','Margin (pt)','24','number')
      +'<label class="df2-check"><input type="checkbox" name="upscale"> Enlarge small images to fit the page</label><div class="df2-scan-review" data-scan-review></div>';
    case 'forms':return `<div data-form-host></div><label class="df2-check"><input type="checkbox" name="flatten"> Flatten the filled fields</label><p>Flattening makes fields permanent and removes their interactivity. The exported result is reviewed as an actual PDF. Rewriting invalidates existing certificate signatures. Supported text depends on the form's fonts; unsupported characters fail clearly at export.</p>`;
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
function validateToolFiles(tool:V2Tool,files:readonly File[]):void{
  validateInputBudget(files.map(file=>file.size));
  if(tool.id==='office-to-pdf')files.forEach(file=>prepareServerInput(file,serverSettings('office-to-pdf',{})));
  if(['workflow','batch'].includes(tool.id))validatePipelineFiles(files);
  if(tool.id==='redact-secure'&&files.some(file=>file.size>REDACTION_MAX_BYTES))throw Error('Permanent redaction supports a maximum input file size of 40 MB.');
  if(tool.id==='ocr'&&files.some(file=>file.size>40*1024*1024))throw Error('On-device OCR supports a maximum input file size of 40 MB.');
}
async function validateHandoffFile(tool:V2Tool,file:File,signal:AbortSignal):Promise<void>{
  validateToolFiles(tool,[file]);
  if(await file.slice(0,5).text()!=='%PDF-')throw Error('The selected result does not contain a valid PDF header.');
  // Unlock and Repair are meant to handle files the regular preview cannot open.
  if(tool.id==='unlock-pdf'||tool.id==='repair-pdf')return;
  const buffer=await file.arrayBuffer();
  signal.throwIfAborted();
  const inspection=runWorkerOperation('document-inspect',[{name:file.name,type:file.type,buffer}],{},()=>{});
  signal.addEventListener('abort',inspection.cancel,{once:true});
  try{
    const report=(await inspection.result).info?.inspection;
    if(typeof report!=='string')throw Error('The PDF could not be inspected.');
    const {pages}=JSON.parse(report) as {pages:number};
    if(tool.id==='redact-secure'&&pages>REDACTION_MAX_PAGES){
      throw Error('Permanent redaction supports at most 15 pages. Split this document first.');
    }
  }finally{signal.removeEventListener('abort',inspection.cancel);}
}
class DocFlowV2 {
  private files:File[]=[];
  private result:OperationResult|null=null;
  private links:string[]=[];
  private selected=new Set<number>();
  private selectionAnchor:number|null=null;
  private preview:PreviewController|null=null;
  private organizer:PageOrganizer|null=null;
  private imagePreview:V2ImagePreview|null=null;
  private scanReview:ReturnType<typeof mountScanReview>|null=null;
  private photoCorrections:PhotoCorrections=new Map();
  private thumbnailRail:ThumbnailRail|null=null;
  private editor:V2PageEditor|null=null;
  private reader:V2Reader|null=null;
  private redaction:V2Redaction|null=null;
  private redactionDraft=createRedactionDraft();
  private signaturePad:ReturnType<typeof mountSignaturePad>|null=null;
  private signatureInk='';
  private watermarkImage:File|null=null;
  private signatureGeneration=0;
  private ocrPreviewGeneration=0;
  private serverProcessing:V2ServerProcessing|null=null;
  private serverResultReady=false;
  private remoteNavigation:Promise<boolean>|null=null;
  private pipelineDraft=createPipelineDraft(false);
  private pipelineKind:string|null=null;
  private pipelineEditor:V2PipelineEditor|null=null;
  private pipelineReport:PipelineReport|null=null;
  private pipelineZipGeneration=0;
  private formFiller:V2FormFiller|null=null;
  private formDraft=createFormDraft();
  private nativePreviewSource:ArrayBuffer|null=null;
  private nativePreviewKey='null';
  private nativeGeneration=0;
  private nativeOperation:RunningOperation|null=null;
  private nativePreviewBusy=false;
  private review:ReviewData|null=null;
  private disposeReview:(()=>void)|null=null;
  private processingGeneration=0;
  private handoffCheck:AbortController|null=null;
  private readonly revisions=new WorkspaceHistory<WorkspaceRevision>();
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
  private recentTools=readRecentTools();
  private tool:V2Tool|null=null;
  private stage:Stage='upload';

  constructor(private readonly root:HTMLDivElement){
    configureWorkProtection(()=>({busy:this.busy||this.nativePreviewBusy||this.editor?.nativeBusy===true||this.serverProcessing?.held===true||this.handoffCheck!==null,hasWork:this.hasWork()}),()=>{++this.processingGeneration;this.cancel();this.serverProcessing?.dispose();this.serverProcessing=null;this.files=[];this.revisions.clear();this.resetDraft();void this.freePreview();});
    window.addEventListener('hashchange',()=>void this.navigate());
    this.root.addEventListener('click',event=>void this.click(event));
    this.root.addEventListener('input',event=>{this.onInput(event);this.invalidateOcrPreview(event);});
    this.root.addEventListener('change',event=>{this.invalidateResult();this.invalidateOcrPreview(event);});
    this.root.addEventListener('df2-draft-change',event=>{this.invalidateResult();if(this.tool?.id==='edit-pdf'&&this.stage==='work')void this.syncNativePreview((event as CustomEvent<{preview?:ArrayBuffer}>).detail?.preview);});
    subscribeFavorites(()=>this.updateQuickAccess());
    window.addEventListener('storage',event=>{
      if(event.key!==recentToolsKey)return;
      this.recentTools=readRecentTools();
      this.updateQuickAccess();
    });
    window.addEventListener('beforeunload',event=>{if(this.hasWork()){event.preventDefault();event.returnValue='';}});
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
          <button class="df2-iconbutton" data-open-offline aria-label="Offline and storage" title="Offline &amp; storage">⇣</button>
          <button class="df2-iconbutton" data-open-search aria-label="Search PDF tools" title="Search PDF tools">⌕</button>
        </div>
      </header>`;
  }
  private card(tool:V2Tool):string {
    const active=tool.readiness==='active';
    const favorite=isFavorite(tool.id);
    return `<article class="df2-toolcard ${active?'':'df2-coming'}" data-tool-category="${esc(tool.category)}">
      <a href="${active?base+tool.id:'#/'}" data-card-tool="${tool.id}" aria-label="${esc(tool.name)}${active?'':', rebuilding'}">
        <span class="df2-toolicon" aria-hidden="true">${esc(tool.icon)}</span>
        <span class="df2-toolname">${esc(tool.name)}</span>
        <span class="df2-tooldesc">${esc(tool.description)}</span>
        <span class="df2-cardfoot">${active?'<span>Start tool <span aria-hidden="true">↗</span></span>':'<span>Being rebuilt</span>'}</span>
      </a>${active?`<button type="button" class="df2-favorite" data-favorite="${tool.id}" aria-label="Favorite ${esc(tool.name)}" aria-pressed="${favorite}"><span aria-hidden="true">${favorite?'★':'☆'}</span></button>`:''}
    </article>`;
  }
  private quickAccess():string {
    const groups=[['Favorites',[...getFavorites()]],['Recent tools',this.recentTools]] as const;
    return groups.map(([label,ids])=>{
      const links=ids.filter(id=>preferenceToolIds.has(id)).map(id=>`<a href="${base+id}">${esc(getTool(id)!.name)}</a>`);
      return links.length?`<nav aria-label="${label}"><h3>${label}</h3><div class="df2-quick-tools">${links.join('')}</div></nav>`:'';
    }).join('');
  }
  private updateQuickAccess():void {
    const quickAccess=this.root.querySelector<HTMLElement>('[data-quick-access]');
    if(!quickAccess)return;
    quickAccess.innerHTML=this.quickAccess();
    this.root.querySelectorAll<HTMLButtonElement>('[data-favorite]').forEach(button=>{
      const favorite=isFavorite(button.dataset.favorite!);
      button.setAttribute('aria-pressed',String(favorite));
      button.firstElementChild!.textContent=favorite?'★':'☆';
    });
  }
  private setRecentTools(recentTools:string[]):void {
    this.recentTools=recentTools;
    try { localStorage.setItem(recentToolsKey,JSON.stringify(recentTools)); } catch { /* Keep preferences in memory when storage is denied. */ }
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
        <div class="df2-section-intro"><div><p class="df2-overline">YOUR TOOLKIT</p><h2 id="df2-browse-title">What do you need to do?</h2></div><button type="button" class="df2-btn df2-btn-outline" data-open-cloud>Cloud sync</button></div>
        <div class="df2-searchbox"><span aria-hidden="true">⌕</span><input type="search" data-tool-search value="${esc(this.search)}" placeholder="Search tools — merge, sign, compress, convert…" aria-label="Search PDF tools"><span class="df2-search-hint">⌘ K</span></div>
        <div class="df2-quick-access" data-quick-access>${this.quickAccess()}</div>
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
  private hasWork():boolean {
    return this.files.length>0||this.result!==null||Boolean(this.revisions.peek('previous')||this.revisions.peek('next'));
  }
  private async navigate(transition?:WorkspaceTransition):Promise<void> {
    this.handoffCheck?.abort();
    this.handoffCheck=null;
    const requestedHash=location.hash;
    const next=route();
    const navigation=++this.navigationGeneration;
    const handoff=transition?.kind==='handoff'?transition.handoff:undefined;
    const carried=handoff&&this.stage==='result'&&handoff.result===this.result
      &&handoff.toolId===next.id&&next.stage==='work'?handoff.file:null;
    const restoring=transition?.kind==='revision'&&transition.revision.id===next.id
      &&transition.revision.stage===next.stage&&this.revisions.peek(transition.direction)===transition.revision?transition:null;
    if(transition&&!carried&&!restoring){history.replaceState(null,'',this.lastRouteHash);return;}
    if(!carried&&!restoring&&next.id!==(this.tool?.id??null)&&this.hasWork()&&!window.confirm('Leave this document? Your current files, edits and revisions will be discarded.')){
      history.replaceState(null,'',this.lastRouteHash);return;
    }
    if(this.serverProcessing?.held&&!this.serverResultReady){
      history.replaceState(null,'',this.lastRouteHash);
      const stopped=await(this.remoteNavigation??=(this.serverProcessing.stopForNavigation().finally(()=>{this.remoteNavigation=null;})));
      if(navigation!==this.navigationGeneration)return;
      if(!stopped){this.message('Server status is uncertain. Use Check server status or retry cancellation before leaving.');return;}
      history.replaceState(null,'',requestedHash);
    }
    if(this.serverProcessing){this.serverProcessing.dispose();this.serverProcessing=null;this.setServerProcessing(false);}
    this.serverResultReady=false;
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
    this.scanReview?.dispose();this.scanReview=null;
    this.thumbnailRail?.dispose();this.thumbnailRail=null;this.editor?.dispose();this.editor=null;
    this.pipelineEditor?.dispose();this.pipelineEditor=null;
    // Validated handoffs and revision switches commit together with their route.
    // The old viewer stops synchronously, and its worker can finish closing afterward.
    const release=this.freePreview();
    if(!transition)await release;
    if(navigation!==this.navigationGeneration||location.hash!==requestedHash)return;
    this.disposeReview?.();this.disposeReview=null;
    if(restoring){
      const restored=this.revisions.move(restoring.direction,this.snapshotWorkspace())!;
      this.resetDraft();
      Object.assign(this,restored.state);
    }else if(changedTool){
      if(carried&&!clearsHistory(this.tool!.id))this.revisions.remember(this.snapshotWorkspace());
      else this.revisions.clear();
      this.files=carried?[carried]:[];
      this.resetDraft();
    }
    this.tool=next.id?getTool(next.id)??null:null;
    this.stage=next.stage;
    if(!this.tool){this.lastRouteHash=location.hash||'#/';this.home();return;}
    if(this.tool.readiness!=='active'){this.lastRouteHash=location.hash||'#/';this.unavailable();return;}
    if(changedTool)this.setRecentTools([this.tool.id,...this.recentTools.filter(id=>id!==this.tool!.id)].slice(0,6));
    if(this.stage==='result'&&!this.result)this.stage=this.files.length?'work':'upload';
    if(this.stage==='work'&&!this.files.length)this.stage='upload';
    const canonical=base+this.tool.id+(this.stage==='upload'?'':'/'+this.stage);
    if(location.hash!==canonical)history.replaceState(null,'',canonical);
    this.lastRouteHash=canonical;
    if(this.stage==='upload')this.upload();
    else if(this.stage==='work')this.workspace();
    else this.results();
    if(carried||restoring)window.scrollTo(0,0);
    const heading=this.root.querySelector<HTMLElement>('h1');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
  }
  private captureOptions():void{
    if(this.signaturePad)this.signatureInk=this.signaturePad.getData();
    const form=this.root.querySelector<HTMLFormElement>('[data-options]');
    if(form){this.optionValues={...this.optionValues,...safeOptionValues(form)};this.optionValues._advancedOpen=form.querySelector<HTMLDetailsElement>('details')?.open??false;}
  }
  private snapshotWorkspace():WorkspaceRevision {
    const {files,result,review,optionValues,editorDraft,organizerDraft,redactionDraft,formDraft,signatureInk,
      watermarkImage,photoCorrections,pipelineDraft,pipelineKind,pipelineReport,selected,currentPage,activeFile,zoom,fitMode}=this;
    const payloads=new Set<Blob|ArrayBuffer>(files);
    if(watermarkImage)payloads.add(watermarkImage);
    result?.outputs.forEach(output=>payloads.add(output.buffer));
    pipelineReport?.items.forEach(item=>{if(item.output)payloads.add(item.output.buffer);});
    if(review?.kind==='pdf')payloads.add(review.buffer);
    if(review?.kind==='images')review.images.forEach(image=>payloads.add(image.blob));
    if(review?.kind==='compare'){
      const {comparison}=review;
      payloads.add(comparison.report);payloads.add(comparison.htmlReport);
      for(const item of comparison.previews)if(item){payloads.add(item.left);payloads.add(item.right);payloads.add(item.overlay);}
    }
    const size=[...payloads].reduce((sum,part)=>sum+(part instanceof ArrayBuffer?part.byteLength:part.size),0)
      +signatureInk.length*2+editorDraft.history.retainedImageBytes;
    return {id:this.tool!.id,stage:this.stage==='result'?'result':'work',size,state:{files,result,review,
      optionValues,editorDraft,organizerDraft,redactionDraft,formDraft,signatureInk,watermarkImage,photoCorrections,pipelineDraft,pipelineKind,pipelineReport,
      selected:new Set(selected),currentPage,activeFile,zoom,fitMode}};
  }
  private revisionControls():string {
    const previous=this.revisions.peek('previous'),next=this.revisions.peek('next');
    if(!previous&&!next&&!this.revisions.limited)return '';
    return `<nav class="df2-revisions" aria-label="Revision history">
      <button type="button" class="df2-btn df2-btn-outline" data-revision="previous" ${previous?'':'disabled'}>← Previous revision</button>
      <button type="button" class="df2-btn df2-btn-outline" data-revision="next" ${next?'':'disabled'}>Next revision →</button>
      ${this.revisions.limited?'<p>Some revisions exceeded this tab’s history limit.</p>':''}
    </nav>`;
  }
  private async openRevision(direction:RevisionDirection):Promise<void> {
    const revision=this.revisions.peek(direction);
    if(!revision||location.hash!==this.lastRouteHash)return;
    if(this.busy||this.handoffCheck||this.nativePreviewBusy||this.editor?.nativeBusy||this.serverProcessing?.held){
      this.message('Finish or cancel the current operation before switching revisions.');return;
    }
    history.pushState(null,'',base+revision.id+'/'+revision.stage);
    await this.navigate({kind:'revision',direction,revision});
  }
  private resetDraft():void{
    this.handoffCheck?.abort();
    this.handoffCheck=null;
    // The outgoing form belongs to the discarded document. A following route
    // transition must not capture it back into the new session.
    this.root.querySelector('[data-options]')?.removeAttribute('data-options');
    this.editorDraft=createEditorDraft();this.organizerDraft=createOrganizerDraft();this.optionValues={};
    this.redactionDraft=createRedactionDraft();
    this.formDraft=createFormDraft();
    this.watermarkImage=null;
    this.photoCorrections=new Map();
    this.pipelineDraft=createPipelineDraft(false);this.pipelineKind=null;this.pipelineReport=null;
    ++this.signatureGeneration;this.signaturePad?.dispose();this.signaturePad=null;this.signatureInk='';
    ++this.nativeGeneration;this.nativeOperation?.cancel();this.nativeOperation=null;this.nativePreviewSource=null;this.nativePreviewKey='null';this.nativePreviewBusy=false;
    this.selected.clear();this.currentPage=1;this.activeFile=0;this.zoom=1;this.fitMode='width';this.result=null;this.review=null;
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
            ${tool.id==='images-to-pdf'?'<label class="df2-btn df2-btn-outline">Take a photo<input type="file" data-photo-upload accept="image/jpeg,image/png" capture="environment"></label>':''}
            <small>${tool.id==='office-to-pdf'?'DOCX, PPTX or XLSX · 25 MB · 100 output pages':tool.accepts.includes('.png')?'JPG or PNG images':'PDF documents'} · ${tool.id==='office-to-pdf'?'Server processing requires sign-in and upload consent':tool.id==='redact-secure'?'40 MB · 15 pages maximum':['workflow','batch'].includes(tool.id)?'20 PDFs · 50 MB each · 150 MB total':'150 MB per file · 250 MB total'}</small>
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
    const camera=this.root.querySelector<HTMLInputElement>('[data-photo-upload]');
    camera?.addEventListener('change',()=>{if(camera.files?.length)void this.receive([...camera.files]);});
    if(!drop)return;
    drop.addEventListener('dragover',event=>{event.preventDefault();drop.classList.add('dragging');});
    drop.addEventListener('dragleave',()=>drop.classList.remove('dragging'));
    drop.addEventListener('drop',event=>{event.preventDefault();drop.classList.remove('dragging');if(event.dataTransfer?.files)void this.receive([...event.dataTransfer.files]);});
  }
  private async receive(files:File[]):Promise<void> {
    const tool=this.tool;if(!tool)return;
    const good=files.filter(file=>tool.id==='office-to-pdf'?/\.(docx|pptx|xlsx)$/i.test(file.name):tool.accepts.includes('.png')?(/image\/(png|jpeg)/.test(file.type)||/\.(png|jpe?g)$/i.test(file.name)):(file.type==='application/pdf'||/\.pdf$/i.test(file.name)));
    if(good.length!==files.length||!good.length){const el=this.root.querySelector<HTMLElement>('.df2-upload-note'),message='Choose supported '+(tool.id==='office-to-pdf'?'DOCX/PPTX/XLSX':tool.accepts.includes('.png')?'JPG/PNG':'PDF')+' files only.';if(el)el.textContent=message;else this.message(message);return;}
    if(this.busy||this.serverProcessing?.held){this.message('Cancel or finish this processing attempt before changing files.');return;}
    const candidate=tool.multiple?[...this.files,...good]:good.slice(0,1);
    try{validateToolFiles(tool,candidate);}
    catch(error){
      const note=this.root.querySelector<HTMLElement>('.df2-upload-note');
      const message=error instanceof Error?error.message:'These files exceed the input limit.';
      if(note)note.textContent=message;else this.message(message);
      this.root.querySelectorAll<HTMLInputElement>('[data-file-input],[data-add-file]').forEach(input=>{input.value='';});
      return;
    }
    this.captureOptions();
    if(this.files.length&&!tool.multiple){
      if(!window.confirm('Replace this document? Your current edits and revisions will be discarded.'))return;
      this.revisions.clear();this.resetDraft();
    }
    this.files=candidate;
    this.pipelineReport=null;
    this.selected.clear();if(!tool.multiple)this.currentPage=1;this.result=null;this.review=null;this.disposeReview?.();this.disposeReview=null;
    // One hash-route transition owns the mount; never mount the viewer twice.
    const next=base+tool.id+'/work';
    if(location.hash!==next)location.hash=next;
    else await this.navigate();
  }
  private workspace():void {
    const tool=this.tool!;
    this.organizer?.dispose();this.organizer=null;
    this.imagePreview?.dispose();this.imagePreview=null;
    this.scanReview?.dispose();this.scanReview=null;
    this.thumbnailRail?.dispose();this.thumbnailRail=null;
    this.editor?.dispose();this.editor=null;
    this.pipelineEditor?.dispose();this.pipelineEditor=null;
    this.root.innerHTML=this.header()+`<main id="df2-main" class="df2-work ${tool.id==='organize'?'df2-organizing':''}"><h1 class="df2-sr-only">${esc(tool.name)} workspace</h1>
      <div class="df2-worktop">${this.crumbs()}<div class="df2-work-actions"><button class="df2-subtle" data-change-files>＋ Add files</button><button class="df2-subtle" data-reset>Start over</button></div></div>
      ${this.revisionControls()}
      <div class="df2-workflow">
        <aside class="df2-rail" aria-label="Document pages and files"><div class="df2-pane-title"><strong>${tool.multiple?'Documents':'Pages'}</strong><span>${this.files.length} ${this.files.length===1?'file':'files'}</span></div>
          ${visualPageTools.has(tool.id)?`<div class="df2-page-selection" role="group" aria-label="Page selection" hidden>
            <button type="button" class="df2-subtle" data-select-all-pages aria-label="Select all pages">Select all</button>
            <button type="button" class="df2-subtle" data-clear-pages aria-label="Clear page selection">Clear</button>
            <span data-page-selection-count role="status"></span></div>`:''}
          <div class="df2-rail-list">${this.files.map((file,i)=>`<article class="df2-file" data-file-index="${i}"><span class="df2-file-badge">${tool.id==='office-to-pdf'?esc(file.name.split('.').pop()!.toUpperCase()):'PDF'}</span><div><b title="${esc(file.name)}">${esc(file.name)}</b><small>${bytes(file.size)}</small></div>
          ${['merge','workflow','batch'].includes(tool.id)?`<button type="button" class="df2-subtle df2-file-preview" data-preview-file="${i}" aria-label="Preview ${esc(file.name)}${tool.id==='merge'?', document '+(i+1):''}" aria-pressed="${this.activeFile===i}">Preview</button>`:''}
          ${tool.multiple?`<div class="df2-file-actions"><button data-move-up="${i}" aria-label="Move ${esc(file.name)} up" ${i===0?'disabled':''}>↑</button><button data-move-down="${i}" aria-label="Move ${esc(file.name)} down" ${i===this.files.length-1?'disabled':''}>↓</button><button data-remove-file="${i}" aria-label="Remove ${esc(file.name)}">×</button></div>`:''}</article>`).join('')}
          <div class="df2-page-thumbs" role="group" aria-label="Page thumbnails"></div></div>
        </aside>
        <section class="df2-canvas-pane" aria-label="Document preview">
          <div class="df2-canvas-toolbar"><span class="df2-doc-name" title="${esc(this.files[this.activeFile]?.name??this.files[0]?.name??'')}">${esc(this.files[this.activeFile]?.name??this.files[0]?.name??'')}</span>
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
      <div class="df2-work-bottom"><div class="df2-run-status" role="status" data-run-status>Ready to process · ${this.files.length} ${this.files.length===1?'file':'files'}</div>
        <button class="df2-btn df2-btn-outline" data-cancel-processing aria-label="Cancel processing" hidden>Cancel</button>
        <button class="df2-btn df2-btn-outline df2-mobile-options" aria-controls="df2-options" aria-expanded="false" data-mobile-options>Options</button>
        <button class="df2-btn df2-btn-main" data-run>${tool.id==='workflow'?'Run workflow':tool.id==='batch'?'Run batch':tool.id==='preview'?'Download original':tool.id==='redact-secure'?'Apply permanent redactions':tool.id==='sign-visual'?'Create signed copy':'Run '+esc(tool.name)} <span aria-hidden="true">↗</span></button></div>
    <input hidden type="file" data-add-file accept="${tool.accepts}" ${tool.multiple?'multiple':''}>
    </main>`;
    const form=this.root.querySelector<HTMLFormElement>('[data-options]');if(form)restoreOptions(form,this.optionValues);
    if(['ocr','compress','office-to-pdf'].includes(tool.id))this.updateProcessingMode();
    if(tool.id==='watermark'&&form)this.mountWatermarkSettings(form);
    const scanHost=form?.querySelector<HTMLElement>('[data-scan-review]');
    if(scanHost)this.scanReview=mountScanReview(scanHost,()=>this.files,files=>void this.receive(files),{
      corrections:this.photoCorrections,onCorrection:()=>this.invalidateResult()
    });
    form?.addEventListener('submit',event=>{event.preventDefault();void this.execute();});
    const pipelineHost=this.root.querySelector<HTMLElement>('[data-pipeline-editor]');
    if(pipelineHost){if(this.pipelineKind!==tool.id){this.pipelineDraft=createPipelineDraft(tool.id==='batch');this.pipelineKind=tool.id;}this.pipelineEditor=new V2PipelineEditor(pipelineHost,this.pipelineDraft,tool.id==='batch',()=>this.invalidateResult());const report=document.createElement('section');report.dataset.pipelineLive='';report.setAttribute('aria-label','File queue status');this.root.querySelector('.df2-page-stage')?.append(report);this.paintPipelineReport();}
    const details=form?.querySelector<HTMLDetailsElement>('details');if(details)details.open=this.optionValues._advancedOpen===true;
    const add=this.root.querySelector<HTMLInputElement>('[data-add-file]');
    add?.addEventListener('change',()=>{if(add.files){void this.receive([...add.files]);}});
    this.root.querySelector<HTMLInputElement>('[name=readerPage]')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void this.jumpReaderPage();}});
    void this.loadPreview();
  }
  private mountWatermarkSettings(form:HTMLFormElement):void {
    const mode=form.querySelector<HTMLSelectElement>('[name=watermarkMode]')!;
    const image=form.querySelector<HTMLInputElement>('[data-watermark-image]')!;
    const status=form.querySelector<HTMLElement>('#df2-watermark-image-status')!;
    const showMode=()=>{
      for(const settings of form.querySelectorAll<HTMLFieldSetElement>('[data-watermark-settings]')){
        settings.hidden=settings.disabled=settings.dataset.watermarkSettings!==mode.value;
      }
    };
    const showImage=()=>{status.textContent=this.watermarkImage?'Selected: '+this.watermarkImage.name:'Choose a PNG or JPEG image.';};
    mode.addEventListener('change',showMode);
    image.addEventListener('change',()=>{
      const file=image.files?.[0];
      image.value='';
      if(!file)return;
      try{
        if(!['image/png','image/jpeg'].includes(file.type)&&!/\.(png|jpe?g)$/i.test(file.name))throw Error('Choose a PNG or JPEG watermark image.');
        validateInputBudget([this.files[0]!.size,file.size]);
        this.watermarkImage=file;
        showImage();
      }catch(error){
        status.textContent=(error instanceof Error?error.message:'Invalid image.')+(this.watermarkImage?' Still selected: '+this.watermarkImage.name:'');
      }
    });
    showMode();
    showImage();
  }
  private async loadPreview():Promise<void> {
    const generation=++this.renderId;
    await this.freePreview(false);
    if(generation!==this.renderId)return;
    const file=this.files[this.activeFile]??this.files[0],canvas=this.root.querySelector<HTMLCanvasElement>('[data-page-canvas]'),
      status=this.root.querySelector<HTMLElement>('[data-render-status]');
    if(!file||!canvas||!status)return;
    if(this.tool?.id==='office-to-pdf'){canvas.hidden=true;const paper=this.root.querySelector<HTMLElement>('.df2-canvas-paper'),zoom=this.root.querySelector<HTMLElement>('.df2-zoom');if(paper)paper.hidden=true;if(zoom)zoom.hidden=true;status.textContent='Office preview is available after conversion. Your file stays on this device until you sign in, accept the upload notice and run conversion.';return;}
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
      const source=this.tool?.id==='edit-pdf'&&this.nativePreviewSource?this.nativePreviewSource.slice(0):await file.arrayBuffer();
      if(generation!==this.renderId)return;
      const controller=await createPreview(source,canvas,status);
      if(generation!==this.renderId){await controller.destroy();return;}
      if(this.tool?.id==='redact-secure'&&controller.pageCount>REDACTION_MAX_PAGES){await controller.destroy();const message='Permanent redaction supports at most 15 pages. Split this document first.';this.message(message);const run=this.root.querySelector<HTMLButtonElement>('[data-run]');if(run)run.disabled=true;throw Error(message);}
      this.preview=controller;
      await this.showPage(this.currentPage);
      if(generation!==this.renderId)return;
      if(this.tool?.id==='preview'){
        const paper=this.root.querySelector<HTMLElement>('.df2-canvas-paper'),readerStatus=this.root.querySelector<HTMLElement>('[data-reader-status]');
        const input=this.root.querySelector<HTMLInputElement>('[name=readerPage]');if(input){input.max=String(controller.pageCount);input.value=String(this.currentPage);}
        if(paper&&readerStatus)this.reader=new V2Reader(canvas,paper,readerStatus);
      }
      if(this.tool?.id==='redact-secure'){
        const paper=this.root.querySelector<HTMLElement>('.df2-canvas-paper'),panel=this.root.querySelector<HTMLElement>('.df2-inspector');
        if(paper&&panel)this.redaction=new V2Redaction(canvas,paper,panel,controller.pageCount,this.redactionDraft,()=>this.invalidateResult(),page=>{void this.showPage(page);},()=>this.busy);
      }
      if(this.tool?.id==='forms'){
        const host=this.root.querySelector<HTMLElement>('[data-form-host]'),paper=this.root.querySelector<HTMLElement>('.df2-canvas-paper');
        if(host&&paper){this.formFiller=new V2FormFiller(host,canvas,paper,this.formDraft,()=>this.invalidateResult(),page=>this.showPage(page),()=>{const button=this.root.querySelector<HTMLElement>('[data-mobile-options]');if(button?.getClientRects().length){this.root.querySelector('[data-options-pane]')?.classList.add('opened');button.setAttribute('aria-expanded','true');}});await this.formFiller.load(file);if(generation!==this.renderId)return;}
      }
      if(this.tool?.id==='edit-pdf'||this.tool?.id==='sign-visual'){
        const paper=this.root.querySelector<HTMLElement>('.df2-canvas-paper');
        const panel=this.root.querySelector<HTMLElement>('.df2-inspector');
        if(paper&&panel){
          this.message('Inspecting editable PDF page geometry…');
          const editor=await V2PageEditor.mount(paper,canvas,panel,controller,file,this.editorDraft,this.tool.id==='sign-visual'?'signature':'edit');
          if(generation!==this.renderId){editor.dispose();return;}
          this.editor=editor;
          this.editor.show(this.currentPage);
          this.message(this.tool.id==='sign-visual'?'Draw or type a mark, place it on the page, and review the signed copy.':'Ready to edit supported source content or add text, images and PDF annotations');
          if(this.tool.id==='sign-visual'){const host=this.root.querySelector<HTMLElement>('[data-signature-pad-host]');if(host)this.signaturePad=mountSignaturePad(host,this.signatureInk);}
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
        if(this.tool?.id==='pdf-to-images'||visualPageTools.has(this.tool?.id??''))this.syncPageSelection();
        else this.paintSelectedThumbnails();
        const selection=this.root.querySelector<HTMLElement>('.df2-page-selection');if(selection)selection.hidden=false;
      }
    }catch(error){if(generation===this.renderId&&status){const message=error instanceof Error?error.message:'Preview unavailable';status.textContent=message;if(this.tool?.id==='sign-visual'){this.message(message);this.root.querySelectorAll<HTMLButtonElement>('[data-signature-place],[data-signature-type],[data-run]').forEach(button=>{button.disabled=true;});}}}
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
    this.formFiller?.clearPage();
    this.redaction?.clearPage();
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
    ++this.ocrPreviewGeneration;
    this.formFiller?.dispose();this.formFiller=null;
    if(invalidate)++this.renderId;
    this.reader?.dispose();this.reader=null;
    this.redaction?.dispose();this.redaction=null;
    ++this.signatureGeneration;this.signaturePad?.dispose();this.signaturePad=null;
    const current=this.preview;this.preview=null;
    if(current)await current.destroy().catch(()=>{});
  }
  private freeLinks():void{this.links.forEach(url=>URL.revokeObjectURL(url));this.links=[];}
  private results():void {
    const tool=this.tool!,value=this.result;
    if(!value){this.workspace();return;}
    this.disposeReview?.();this.disposeReview=null;
    this.freeLinks();
    const downloads=value.outputs.map((output,index)=>{
      const url=URL.createObjectURL(new Blob([output.buffer],{type:output.type}));this.links.push(url);
      return `<a class="df2-output" data-result-output="${index}" href="${url}" download="${esc(output.name)}"><span class="df2-output-icon">↓</span><span><b>${esc(output.name)}</b><small>${bytes(output.buffer.byteLength)} · Ready to download</small></span><strong>Download →</strong></a>`;
    }).join('');
    const pdfs=value.outputs.filter(output=>output.type==='application/pdf'&&output.buffer.byteLength>0);
    const rename=value.outputs.length?`<details class="df2-result-handoff">
      <summary>Rename downloads</summary>
      <form data-result-rename>
        ${value.outputs.length>1?select('output','File to rename',value.outputs.map((output,index)=>[String(index),esc(output.name)])):''}
        <label class="df2-control">Output filename<input name="filename" maxlength="110" required autocomplete="off" value="${esc(value.outputs[0]!.name)}"></label>
        <button type="submit" class="df2-btn df2-btn-outline">Save filename</button>
        <p role="status"></p>
      </form>
    </details>`:'';
    const destinations=activeTools.filter(candidate=>candidate.id!==tool.id
      &&candidate.accepts.split(',').includes('application/pdf')
      &&(tool.id!=='protect-pdf'||candidate.id==='unlock-pdf'));
    const handoff=pdfs.length&&destinations.length?`<details class="df2-result-handoff">
      <summary>Use PDF in another tool</summary>
      <form data-result-handoff>
        ${pdfs.length>1?`<label class="df2-control">PDF result<select name="pdf" required><option value="">Choose a PDF</option>${pdfs.map((file,index)=>`<option value="${index}">${esc(file.name)}</option>`).join('')}</select></label>`:''}
        <label class="df2-control">Next tool<select name="tool" required><option value="">Choose a tool</option>${destinations.map(candidate=>`<option value="${candidate.id}">${esc(candidate.name)}</option>`).join('')}</select></label>
        <p id="df2-handoff-note">${clearsHistory(tool.id)?'Open the selected PDF on this device. This clears earlier workspaces from revision history.':'Open the selected PDF on this device. Previous revision can reopen the result while it remains in this tab’s history.'} Download any results you want to keep.</p>
        <button class="df2-btn df2-btn-outline" type="submit" aria-describedby="df2-handoff-note">Open selected PDF</button>
        <p data-handoff-status role="status"></p>
      </form>
    </details>`:'';
    const compression=tool.id==='compress'?compressionSummary(value.info):null;
    const compressionMarkup=compression?`<section class="df2-compression-summary" data-compression-summary aria-label="Compression results"><strong>${compression.savedBytes>0?compression.percent+'% smaller':'No size reduction'}</strong><p>Original ${bytes(compression.input)} → Result ${bytes(compression.output)}</p><p>${value.info?.provider?'Review image detail and page appearance in the exported PDF.':compression.recompressed+' of '+compression.eligible+' eligible JPEG images recompressed. Text and vector objects preserved.'}</p>${compression.savedBytes?'':'<p>This document may already be optimised or use unsupported image encodings. Your original is available below.</p>'}</section>`:'';
    const warning=value.info?.warning?`<p class="df2-review-warning" role="status">${esc(String(value.info.warning))}</p>`:'';
    this.root.innerHTML=this.header()+`<main id="df2-main" class="df2-result">${this.crumbs()}${this.progress()}
      <div class="df2-result-card"><span class="df2-result-check ${this.review?.kind==='pipeline'?'df2-result-queue':''}" aria-hidden="true">${this.review?.kind==='pipeline'?'≡':'✓'}</span><p class="df2-overline">${this.review?.kind==='pipeline'?'QUEUE FINISHED':'DOCUMENT READY'}</p>
        <h1>${this.review?.kind==='pipeline'?'Your queue results.':this.review?.kind==='images'?'Your images are ready.':this.review?.kind==='pdf'?'Your PDF is ready.':this.review?'Your analysis is ready.':'Your document is ready.'}</h1><p>${this.review?.kind==='pipeline'?'Check each file status and review the completed PDFs. Return to editing to retry failed or cancelled files with their original settings.':this.review?.kind==='images'?'Review each extracted image below. Download a PNG or the complete ZIP archive.':this.review?.kind==='pdf'?'Review the actual exported PDF below before downloading and sharing.':this.review?'Review the findings below and download the detailed reports.': 'Your original file has not been overwritten.'}</p>
        ${warning}${compressionMarkup}
        <div class="df2-downloads">${downloads||'<p>No downloadable file for this inspection operation.</p>'}</div>
        ${this.review?.kind==='pipeline'&&value.outputs.length?'<button type="button" class="df2-btn df2-btn-outline" data-pipeline-zip>Prepare ZIP of completed PDFs</button><p data-pipeline-zip-status role="status"></p>':''}
        <div class="df2-result-actions"><button class="df2-btn df2-btn-outline" data-return-edit>Return to editing</button><button class="df2-btn df2-btn-outline" data-again>Start another file</button><a class="df2-btn df2-btn-subtle" href="#/">See all tools →</a></div>
        ${this.revisionControls()}
        ${rename}
        ${handoff}
        ${this.review?'<div data-v2-review-container></div>':''}
        ${value.info&&this.review?.kind!=='pipeline'?`<details class="df2-result-info"><summary>Processing details</summary><pre>${esc(JSON.stringify(value.info,null,2))}</pre></details>`:''}
      </div></main>`;
    const handoffForm=this.root.querySelector<HTMLFormElement>('[data-result-handoff]');
    handoffForm?.addEventListener('submit',event=>{
      event.preventDefault();
      const selection=new FormData(handoffForm);
      const destination=destinations.find(candidate=>candidate.id===selection.get('tool'));
      const index=selection.get('pdf');
      const fileIndex=typeof index==='string'&&/^\d+$/.test(index)?Number(index):-1;
      const output=pdfs[pdfs.length===1?0:fileIndex];
      if(destination&&output){
        const file=new File([output.buffer],output.name,{type:output.type});
        void this.openResultInTool(handoffForm,{result:value,toolId:destination.id,file},destination);
      }
    });
    this.mountResultRename(value,pdfs);
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
  private mountResultRename(result:OperationResult,pdfs:OutputFile[]):void{
    const form=this.root.querySelector<HTMLFormElement>('[data-result-rename]');
    if(!form)return;
    const picker=form.querySelector<HTMLSelectElement>('[name=output]');
    const input=form.querySelector<HTMLInputElement>('[name=filename]')!;
    const status=form.querySelector<HTMLElement>('[role=status]')!;
    picker?.addEventListener('change',()=>{
      input.value=result.outputs[picker.selectedIndex]!.name;
      status.textContent='';
    });
    form.addEventListener('submit',event=>{
      event.preventDefault();
      if(this.handoffCheck||this.result!==result)return;
      const index=picker?.selectedIndex??0;
      const output=result.outputs[index];
      if(!output)return;
      const name=outputFilename(input.value,output.name);
      if(result.outputs.some(other=>other!==output&&other.name.toLowerCase()===name.toLowerCase())){
        status.textContent='Another download already uses that filename.';
        return;
      }
      if(name!==output.name){
        output.name=name;
        const link=this.root.querySelector<HTMLAnchorElement>(`[data-result-output="${index}"]`)!;
        link.download=name;
        link.querySelector('b')!.textContent=name;
        if(picker)picker.options[index]!.text=name;
        const handoff=this.root.querySelector<HTMLOptionElement>(`[data-result-handoff] [name=pdf] option[value="${pdfs.indexOf(output)}"]`);
        if(handoff)handoff.text=name;
        const preview=this.root.querySelector<HTMLSelectElement>('[data-pipeline-preview-select]');
        if(preview){
          preview.options[index]!.text=name;
          const title=this.root.querySelector<HTMLElement>('[data-pipeline-preview] h2');
          if(title&&preview.selectedIndex===index)title.textContent='Review '+name;
          this.clearPipelineZip();
        }
      }
      input.value=name;
      status.textContent='Saved as '+name+'.';
    });
  }
  private async openResultInTool(form:HTMLFormElement,handoff:ResultHandoff,destination:V2Tool):Promise<void>{
    const current=()=>form.isConnected&&this.stage==='result'&&this.result===handoff.result
      &&location.hash===this.lastRouteHash;
    if(this.handoffCheck||!current())return;

    const controller=new AbortController();
    this.handoffCheck=controller;
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(15_000)]);
    const controls=[...form.querySelectorAll<HTMLSelectElement|HTMLButtonElement>('select,button'),
      ...this.root.querySelectorAll<HTMLButtonElement>('[data-revision]:enabled,[data-result-rename] button')];
    const status=form.querySelector<HTMLElement>('[data-handoff-status]')!;
    controls.forEach(control=>{control.disabled=true;});
    status.textContent='Checking the PDF…';
    try{
      await validateHandoffFile(destination,handoff.file,signal);
      signal.throwIfAborted();
    }catch(error){
      if(current()&&!controller.signal.aborted){
        status.textContent=signal.aborted?'Checking this PDF timed out. Try again or download the result.':
          error instanceof Error?error.message:'This PDF cannot be opened in the selected tool.';
      }
      return;
    }finally{
      if(this.handoffCheck===controller)this.handoffCheck=null;
      controls.forEach(control=>{control.disabled=false;});
      if(controller.signal.aborted&&form.isConnected)status.textContent='';
    }
    if(!current()||controller.signal.aborted)return;
    history.pushState(null,'',base+handoff.toolId+'/work');
    await this.navigate({kind:'handoff',handoff});
  }
  private async execute():Promise<void>{
    const tool=this.tool;
    if(tool&&['workflow','batch'].includes(tool.id)){await this.executePipeline('run');return;}
    if(this.busy||!tool||(!tool.operation&&!['office-to-pdf','ocr','redact-secure','preview','pdf-to-images','extract-images','text-search','compare','protect-pdf','unlock-pdf','repair-pdf'].includes(tool.id))||!this.files.length)return;
    if(tool.id==='merge'&&this.files.length<2){this.message('Choose at least two PDFs to merge.');return;}
    if(tool.id==='compare'&&this.files.length!==2){this.message('Choose exactly two PDFs, A then B, to compare.');return;}
    const form=this.root.querySelector<HTMLFormElement>('[data-options]');
    if(!form)return;
    const options=readOptions(form);
    const imageWatermark=tool.id==='watermark'&&options.watermarkMode==='image';
    const watermarkImage=imageWatermark?this.watermarkImage:null;
    if(imageWatermark&&!form.reportValidity())return;
    if(imageWatermark&&!watermarkImage){this.message('Choose a PNG or JPEG watermark image.');return;}
    if(imageWatermark)options.rotation=options.imageRotation;
    if(tool.id==='office-to-pdf'||['ocr','compress'].includes(tool.id)&&form.querySelector<HTMLSelectElement>('[name=processingMode]')?.value==='server'){this.serverProcessing?.start(this.files[0]!);return;}
    if(tool.id==='ocr'){if(!form.reportValidity())return;try{scanOptions(options);}catch(error){this.message(error instanceof Error?error.message:'Invalid recognition settings.');return;}}
    if(tool.id==='forms'){try{if(!this.formFiller)throw Error('Wait for the form preview to finish loading.');options.values=this.formFiller.exportValues();}catch(error){this.message(error instanceof Error?error.message:'Form fields could not be read.');return;}}
    if(tool.id==='redact-secure'){
      if(!options.confirmRasterization){this.message('Please confirm the warning that every page becomes an image and document structure is removed.');return;}
      if(!this.redaction){this.message('Wait for the redaction preview to finish loading.');return;}
      if(this.redaction.hasPending){this.message('Finish drawing the current area before processing.');return;}
      if(!this.redactionDraft.marks.length){this.message('Mark at least one redaction area before processing.');return;}
    }
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
    if(tool.id==='sign-visual'){
      if(!this.editor){this.message('Wait for signature placement to finish loading.');return;}
      const plan=this.editor.currentPlan;if(!plan.objects.some(object=>object.kind==='signature')){this.message('Place at least one signature on the document first.');return;}
      options.plan=plan;options.requireUnsigned=true;
    }
    if(tool.id==='organize'){
      if(!this.organizer){this.message('Wait for the page preview to finish loading.');return;}
      options.order=this.organizer.getOrder().join(',');
    }
    if(tool.id==='rotate')options.degrees=Number(options.degrees);
    if(tool.id==='split')options.individualPdfResults=options.splitOutput==='pdfs';
    if(tool.id==='compress'){
      Object.assign(options,compressionSettings(options));
    }
    const previewPageCount=this.preview?.pageCount;
    if(previewPageCount&&visualPageTools.has(tool.id)&&(tool.id!=='split'||options.mode==='selected'||options.mode==='ranges')){
      try{
        if(tool.id==='split'&&options.mode==='ranges')parseSplitRanges(String(options.ranges??''),previewPageCount);
        else {
          const pages=parseRequiredPageSelection(String(options.pages??''),previewPageCount);
          if(tool.id==='remove-pages'&&pages.length===previewPageCount)throw Error('Keep at least one page in the PDF.');
        }
      }catch(error){this.message(error instanceof Error?error.message:'Enter a valid page range.');return;}
    }
    const button=this.root.querySelector<HTMLButtonElement>('[data-run]');
    const generation=++this.processingGeneration;
    this.setProcessing(true);this.message('Preparing files…');
    const progressMessage=(message:string)=>{if(generation===this.processingGeneration)this.message(message);};
    try{
      let sourceFiles=watermarkImage?[...this.files,watermarkImage]:this.files;
      if(this.scanReview){
        const abort=new AbortController();
        this.cancel=()=>abort.abort();
        sourceFiles=await this.scanReview.inputs(abort.signal,(done,total)=>progressMessage('Preparing photo '+done+' of '+total));
        validateInputBudget(sourceFiles.map(file=>file.size));
      }
      if(generation!==this.processingGeneration)return;
      const input=await Promise.all(sourceFiles.map(async f=>({name:f.name,type:f.type,buffer:await f.arrayBuffer()})));
      if(tool.id==='edit-pdf' && this.editor?.containsText){
        const response=await fetch(`${import.meta.env.BASE_URL}fonts/DocFlowSans.woff`);
        if(!response.ok)throw Error('Editor font unavailable. Reconnect and retry.');
        input.push({name:'DocFlowSans.woff',type:'font/ttf',buffer:await response.arrayBuffer()});
      }
      if(generation!==this.processingGeneration)return;
      let result:OperationResult;
      if(tool.id==='ocr'){
        const abort=new AbortController();this.cancel=()=>abort.abort();
        const {ocrPdf}=await import('../pdf/localOcr');
        if(generation!==this.processingGeneration){abort.abort();return;}
        const report=await ocrPdf(input[0]!.buffer,{language:options.language==='deu'?'deu':options.language==='eng+deu'?'eng+deu':'eng',pages:String(options.pages??''),maxPages:Number(options.maxPages??10),skipExistingText:options.skipExistingText!==false,preprocessing:scanOptions(options)},(done,total,note)=>progressMessage(note+' · '+done+' of '+total+' selected pages'),abort.signal);
        result=report.output;
        if(generation===this.processingGeneration)this.review={kind:'pdf',title:'Review searchable OCR PDF',buffer:result.outputs[0]!.buffer};
      }else if(tool.id==='redact-secure'){
        const abort=new AbortController();this.cancel=()=>abort.abort();
        const marks=this.redactionDraft.marks.map(mark=>({...mark}));
        result=await redactPdf(input[0]!.buffer,marks,event=>progressMessage(event.message+' · '+Math.round(event.current*100/Math.max(1,event.total))+'%'),abort.signal,Number(options.redactionDpi??115.2));
        if(generation!==this.processingGeneration)return;
        this.review={kind:'pdf',title:'Review redacted PDF',buffer:result.outputs[0]!.buffer};
      }else if(tool.id==='preview'){
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
        let pageCount=0;
        const blob=await pdfToImages(input[0]!.buffer,format,Number.isFinite(scale)?scale:1.5,
          (done,total)=>{
            pageCount=total;
            progressMessage('Rendering image '+done+' of '+total+' · '+Math.round(done*100/total)+'%');
          },
          ()=>cancelled||generation!==this.processingGeneration,String(options.pages??''));
        result={outputs:[{name:'pdf-pages.zip',type:'application/zip',buffer:await blob.arrayBuffer()}],
          info:{format,pageCount}};
      }else{
        const operation:WorkerOperation=imageWatermark?'watermark-image':tool.operation!;
        const running=runWorkerOperation(operation,input,options,p=>progressMessage(p.message+' · '+p.percent+'%'));
        this.cancel=running.cancel;
        result=await running.result;
      }
      if(tool.id==='sign-visual'&&generation===this.processingGeneration){result.outputs[0]!.name='visually-signed.pdf';this.review={kind:'pdf',title:'Review visually signed PDF',buffer:result.outputs[0]!.buffer};}
      if(tool.id==='forms'&&generation===this.processingGeneration)this.review={kind:'pdf',title:'Review '+(options.flatten?'flattened':'filled')+' PDF form',buffer:result.outputs[0]!.buffer};
      if(generation!==this.processingGeneration)return;
      if(tool.id==='watermark')this.review={kind:'pdf',title:'Review watermarked PDF',buffer:result.outputs[0]!.buffer};
      if(clearsHistory(tool.id))this.revisions.clear();
      this.result=result;
      this.busy=false;
      this.cancel=()=>{};
      // Hashchange is the single authority for transition to result stage.
      location.hash=base+tool.id+'/result';
    }catch(error){if(generation===this.processingGeneration)this.message(error instanceof Error?'Could not finish: '+error.message:'Processing failed.');}
    finally {if(generation===this.processingGeneration){this.setProcessing(false);if(button)button.disabled=false;this.cancel=()=>{};}}
  }
  private paintPipelineReport():void{const host=this.root.querySelector<HTMLElement>('[data-pipeline-live]');if(host){host.replaceChildren();if(this.pipelineReport)mountPipelineReport(host,this.pipelineReport);}}
  private async executePipeline(mode:'run'|'retry'|'check'):Promise<void>{
    if(this.busy||!this.pipelineEditor||!this.files.length||!this.tool)return;
    const generation=++this.processingGeneration,tool=this.tool;let report:PipelineReport;
    try{
      this.pipelineEditor.cancelPendingImport();
      if(mode==='retry'&&!this.pipelineReport?.items.some(item=>item.state==='failed'||item.state==='cancelled'))throw Error('No failed or cancelled files to retry.');
      const recipe=mode==='retry'?this.pipelineReport!.items[0]!.recipe:this.pipelineEditor.recipe;
      report=createPipeline(this.files,recipe,mode==='retry'?this.pipelineReport!:undefined);
    }catch(error){this.message(error instanceof Error?error.message:'Invalid workflow.');return;}
    this.invalidateResult();this.pipelineReport=report;this.paintPipelineReport();let cancelled=false,active:RunningOperation|null=null;
    this.cancel=()=>{cancelled=true;active?.cancel();};this.setProcessing(true);
    try{
      await runPipeline(report,runWorkerOperation,{cancelled:()=>cancelled||generation!==this.processingGeneration,active:job=>{active=job;if(cancelled)job?.cancel();},update:message=>{if(generation===this.processingGeneration){this.message(message);this.paintPipelineReport();}},checkOnly:mode==='check'});
      if(generation!==this.processingGeneration)return;
      this.paintPipelineReport();this.message((mode==='check'?'Check finished · ':'Queue finished · ')+pipelineSummary(report));
      if(mode!=='check'){
        const outputs=report.items.flatMap(item=>item.output?[item.output]:[]);
        this.disposeReview?.();this.disposeReview=null;this.review={kind:'pipeline',report};this.result={outputs,info:{summary:pipelineSummary(report),warning:report.items.some(item=>['failed','cancelled'].includes(item.state))?'Some files did not complete. Review the per-file report; only completed PDFs are downloadable.':''}};
        location.hash=base+tool.id+'/result';
      }
    }finally{if(generation===this.processingGeneration){this.cancel=()=>{};this.setProcessing(false);}}
  }
  private async preparePipelineZip():Promise<void>{
    if(this.busy||this.stage!=='result'||this.review?.kind!=='pipeline'||!this.result)return;
    const outputs=this.result.outputs.filter(out=>out.type==='application/pdf'),button=this.root.querySelector<HTMLButtonElement>('[data-pipeline-zip]'),status=this.root.querySelector<HTMLElement>('[data-pipeline-zip-status]');if(!button||button.disabled||!status||!outputs.length)return;
    if(outputs.reduce((sum,out)=>sum+out.buffer.byteLength,0)>75*1024*1024){status.textContent='ZIP preparation supports up to 75 MB of completed PDFs. Download these PDFs individually.';return;}
    const generation=this.processingGeneration,navigation=this.navigationGeneration;button.disabled=true;button.setAttribute('aria-busy','true');status.textContent='Preparing ZIP…';
    const zipGeneration=++this.pipelineZipGeneration;
    const current=()=>generation===this.processingGeneration&&navigation===this.navigationGeneration&&zipGeneration===this.pipelineZipGeneration;
    try{
      const {default:JSZip}=await import('jszip');
      if(!current())return;
      const zip=new JSZip();outputs.forEach(out=>zip.file(out.name,out.buffer));
      const blob=await zip.generateAsync({type:'blob',compression:'STORE'},()=>{if(!current())throw new DOMException('Cancelled','AbortError');});
      if(!current())return;
      const url=URL.createObjectURL(blob);this.links.push(url);const link=document.createElement('a');link.className='df2-output';link.dataset.pipelineZipOutput='';link.href=url;link.download='docflow-results.zip';link.textContent='Download all completed PDFs · '+bytes(blob.size);this.root.querySelector('.df2-downloads')?.append(link);button.hidden=true;status.textContent='ZIP ready · '+outputs.length+' completed PDFs. ZIP preparation limit: 75 MB.';
    }catch(error){if(current()){status.textContent=error instanceof Error?error.message:'ZIP could not be prepared.';button.disabled=false;}}
    finally{if(current())button.setAttribute('aria-busy','false');}
  }
  private clearPipelineZip():void{
    const link=this.root.querySelector<HTMLAnchorElement>('[data-pipeline-zip-output]');
    const button=this.root.querySelector<HTMLButtonElement>('[data-pipeline-zip]');
    const status=this.root.querySelector<HTMLElement>('[data-pipeline-zip-status]');
    if(!button||!status||(!link&&!button.disabled))return;
    ++this.pipelineZipGeneration;
    if(link){
      URL.revokeObjectURL(link.href);
      this.links=this.links.filter(url=>url!==link.href);
      link.remove();
    }
    button.disabled=button.hidden=false;
    button.setAttribute('aria-busy','false');
    status.textContent='Filenames changed. Prepare a new ZIP.';
  }
  private setServerProcessing(value:boolean):void{
    this.busy=value;
    const run=this.root.querySelector<HTMLButtonElement>('[data-run]');if(run)run.disabled=value;
    const cancel=this.root.querySelector<HTMLButtonElement>('[data-cancel-processing]');if(cancel)cancel.hidden=!value;
  }
  private updateProcessingMode():void{
    const form=this.root.querySelector<HTMLFormElement>('[data-options]'),host=form?.querySelector<HTMLElement>('[data-processing-server]'),local=form?.querySelector<HTMLFieldSetElement>('[data-processing-local]');
    if(!form||!host)return;
    const server=(this.tool?.id==='office-to-pdf'||form.querySelector<HTMLSelectElement>('[name=processingMode]')?.value==='server')&&serverProcessingAvailable();
    if(local){local.hidden=server;local.disabled=server;}host.hidden=!server;
    if(server&&!this.serverProcessing){
      const operation=this.tool?.id==='compress'?'compress':this.tool?.id==='office-to-pdf'?'office-to-pdf':'ocr',toolId=this.tool!.id;
      this.serverProcessing=new V2ServerProcessing(host,form,result=>{
        this.disposeReview?.();this.disposeReview=null;this.result=result;this.review={kind:'pdf',title:operation==='ocr'?'Review server OCR PDF':operation==='compress'?'Review server compressed PDF':'Review converted Office PDF',buffer:result.outputs[0]!.buffer};this.serverResultReady=true;location.hash=base+toolId+'/result';
      },held=>this.setServerProcessing(held),message=>this.message(message),operation);
      const values={...this.optionValues};delete values.processingMode;restoreOptions(form,values);
    }else if(!server&&this.serverProcessing&&!this.serverProcessing.held){this.serverProcessing.dispose();this.serverProcessing=null;host.replaceChildren();}
  }
  private setProcessing(value:boolean):void{
    this.busy=value;
    const run=this.root.querySelector<HTMLButtonElement>('[data-run]');if(run)run.disabled=value;
    const cancel=this.root.querySelector<HTMLButtonElement>('[data-cancel-processing]');if(cancel)cancel.hidden=!value;
    const content=this.root.querySelector<HTMLElement>('.df2-workflow');if(content)content.inert=value;
  }
  private message(value:string):void{const node=this.root.querySelector<HTMLElement>('[data-run-status]');if(node)node.textContent=value;}
  private invalidateOcrPreview(event:Event):void{
    const target=event.target;
    if(this.tool?.id!=='ocr'||!(target instanceof HTMLInputElement||target instanceof HTMLSelectElement)||!['rotation','deskew','cleanup','previewPage'].includes(target.name))return;
    ++this.ocrPreviewGeneration;
    const host=this.root.querySelector<HTMLElement>('[data-ocr-preview-pair]');
    host?.querySelectorAll('canvas').forEach(canvas=>{canvas.width=canvas.height=1;});host?.replaceChildren();
    const status=this.root.querySelector<HTMLElement>('[data-ocr-preview-status]');if(status)status.textContent='Settings changed. Review the recognition preview again.';
  }
  private async previewOcr():Promise<void>{
    const file=this.files[0],form=this.root.querySelector<HTMLFormElement>('[data-options]'),host=this.root.querySelector<HTMLElement>('[data-ocr-preview-pair]'),status=this.root.querySelector<HTMLElement>('[data-ocr-preview-status]');
    if(this.busy||this.tool?.id!=='ocr'||!file||!form||!host||!status)return;
    const generation=++this.ocrPreviewGeneration;
    status.textContent='Preparing recognition preview…';
    try{
      const options=readOptions(form),preprocessing=scanOptions(options),page=Number(options.previewPage??1),key=JSON.stringify([options.rotation,options.deskew,options.cleanup,options.previewPage]);
      const {ocrPreview}=await import('../pdf/localOcr');
      const pair=await ocrPreview(await file.arrayBuffer(),page,preprocessing);
      if(generation!==this.ocrPreviewGeneration||this.files[0]!==file||!host.isConnected){pair.original.width=pair.original.height=pair.corrected.width=pair.corrected.height=1;return;}
      const latest=readOptions(form);if(key!==JSON.stringify([latest.rotation,latest.deskew,latest.cleanup,latest.previewPage])){pair.original.width=pair.original.height=pair.corrected.width=pair.corrected.height=1;status.textContent='Settings changed. Review the recognition preview again.';return;}
      host.replaceChildren();
      for(const [canvas,label] of [[pair.original,'Source scan · stays visible'],[pair.corrected,'Recognition input · corrections only']] as const){const figure=document.createElement('figure'),caption=document.createElement('figcaption');canvas.setAttribute('role','img');canvas.setAttribute('aria-label',label);canvas.style.maxWidth='100%';canvas.style.height='auto';caption.textContent=label;figure.append(canvas,caption);host.append(figure);}
      status.textContent='Preview page '+page+'. Corrections affect recognition only; source appearance stays unchanged.';
    }catch(error){if(generation===this.ocrPreviewGeneration)status.textContent=error instanceof Error?error.message:'Recognition preview unavailable.';}
  }
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
    if(target instanceof HTMLSelectElement&&target.name==='processingMode'){this.captureOptions();this.updateProcessingMode();}
    if((this.tool?.id==='pdf-to-images'||visualPageTools.has(this.tool?.id??''))&&target instanceof HTMLInputElement&&target.name==='pages')this.syncPageSelection();
    if(target instanceof HTMLSelectElement&&target.name==='compressionPreset'){
      const preset=compressionPresets[target.value];
      const form=target.form;if(preset&&form){form.querySelector<HTMLInputElement>('[name=jpegQuality]')!.value=String(Math.round(preset.imageQuality*100));form.querySelector<HTMLInputElement>('[name=maxImagePixels]')!.value=String(preset.maxImageDimension);}
    }
    if(target instanceof HTMLInputElement&&['jpegQuality','maxImagePixels'].includes(target.name)){
      const preset=target.form?.querySelector<HTMLSelectElement>('[name=compressionPreset]');if(preset)preset.value='custom';
    }
    this.invalidateResult();
  }
  private syncPageSelection():void {
    const input=this.root.querySelector<HTMLInputElement>('[data-options] [name=pages]');
    if(!input||!this.preview)return;
    this.selected.clear();
    this.selectionAnchor=null;
    try{
      if(input.value.trim())parseRequiredPageSelection(input.value,this.preview.pageCount).forEach(page=>this.selected.add(page+1));
      input.removeAttribute('aria-invalid');
    }catch{input.setAttribute('aria-invalid','true');}
    this.paintSelectedThumbnails();
  }
  private commitPageSelection(input:HTMLInputElement):void{
    const mode=input.form?.querySelector<HTMLSelectElement>('[name=mode]');
    if(this.tool?.id==='split'&&mode)mode.value='selected';
    input.value=range(this.selected);
    input.removeAttribute('aria-invalid');
    this.invalidateResult();
    this.paintSelectedThumbnails();
  }
  private paintSelectedThumbnails():void {
    this.root.querySelectorAll<HTMLButtonElement>('.df2-thumb[data-page]').forEach(button=>{
      button.setAttribute('aria-pressed',String(this.selected.has(Number(button.dataset.page))));
    });
    const count=this.root.querySelector<HTMLElement>('[data-page-selection-count]');
    if(count&&this.preview)count.textContent=this.selected.size+' of '+this.preview.pageCount+' selected';
  }
  private async jumpReaderPage():Promise<void>{
    const input=this.root.querySelector<HTMLInputElement>('[name=readerPage]'),status=this.root.querySelector<HTMLElement>('[data-reader-status]');if(!input||!status)return;
    const page=Number(input.value),count=this.preview?.pageCount;
    if(!count){status.textContent='Wait for the document preview to finish loading.';return;}
    if(!Number.isInteger(page)||page<1||page>count){input.setAttribute('aria-invalid','true');status.textContent='Choose a page from 1–'+count+'.';return;}
    input.removeAttribute('aria-invalid');await this.showPage(page);
  }
  private async placeSignature(typed:boolean):Promise<void>{
    const editor=this.editor,generation=this.signatureGeneration;if(this.busy||this.tool?.id!=='sign-visual'||!editor){this.message('Wait for signature placement to finish loading.');return;}
    try{
      const data=typed?await typedSignature(this.root.querySelector<HTMLInputElement>('[name=signatureText]')?.value??''):this.signaturePad?.getData();
      if(generation!==this.signatureGeneration||editor!==this.editor||this.stage!=='work')return;
      if(!data)throw Error('Draw a signature first or enter your name.');editor.placeSignature(data);this.invalidateResult();this.message('Signature placed. Move or resize it on the page, then create a signed copy.');
    }catch(error){if(generation===this.signatureGeneration)this.message(error instanceof Error?error.message:'Signature could not be placed.');}
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
    const favorite=target.closest<HTMLButtonElement>('[data-favorite]')?.dataset.favorite;
    if(favorite&&preferenceToolIds.has(favorite)){toggleFavorite(favorite);return;}
    const cloud=target.closest<HTMLButtonElement>('[data-open-cloud]');
    if(cloud){
      openPreferencesDialog(cloud,{
        allowedToolIds:preferenceToolIds,
        capture:()=>({favorite_tools:[...getFavorites()],recent_tools:this.recentTools}),
        apply:state=>{
          this.setRecentTools(state.recent_tools);
          replaceFavorites(state.favorite_tools);
        }
      });
      return;
    }
    if(target.closest('[data-open-offline]')){openOfflineDialog(target.closest<HTMLElement>('[data-open-offline]'));return;}
    if(target.closest('[data-open-search]')){this.openSearch();return;}
    const revision=target.closest<HTMLElement>('[data-revision]')?.dataset.revision;
    if(revision==='previous'||revision==='next'){await this.openRevision(revision);return;}
    if(target.closest('[data-ocr-preview]')){await this.previewOcr();return;}
    if(target.closest('[data-cancel-processing]')){if(this.serverProcessing?.held){await this.serverProcessing.cancel();return;}if(this.tool&&['workflow','batch'].includes(this.tool.id)){this.cancel();this.message('Cancelling queue · completed PDFs will remain available.');return;}++this.processingGeneration;this.cancel();this.cancel=()=>{};this.setProcessing(false);this.message('Cancelled · your document and settings are ready to use.');return;}
    const t=target.closest<HTMLElement>('[data-card-tool]');
    if(t&&getTool(t.dataset.cardTool??'')?.readiness!=='active'){event.preventDefault();const tool=getTool(t.dataset.cardTool??'');if(tool){this.tool=tool;this.unavailable();}return;}
    if(target.closest('[data-return-edit]')){location.hash=base+this.tool!.id+'/work';return;}
    if(target.closest('[data-show-grid]')){this.root.querySelector('.df2-work')?.classList.remove('df2-page-preview');this.root.querySelector<HTMLButtonElement>('[data-show-grid]')!.hidden=true;return;}
    if(target.closest('[data-reset],[data-again]')){if(this.serverProcessing?.held){this.message('Cancel or finish this server attempt before starting over.');return;}if(this.stage==='work'&&this.hasWork()&&!window.confirm('Start over? Your current files, edits and revisions will be discarded.'))return;this.files=[];this.revisions.clear();this.resetDraft();if(this.tool)location.hash=base+this.tool.id;else location.hash='#/';return;}
    if(target.closest('[data-change-files]')){this.root.querySelector<HTMLInputElement>('[data-add-file]')?.click();return;}
    if(target.closest('[data-pipeline-check]')){await this.executePipeline('check');return;}
    if(target.closest('[data-pipeline-retry]')){await this.executePipeline('retry');return;}
    if(target.closest('[data-pipeline-zip]')){await this.preparePipelineZip();return;}
    const previewFile=target.closest<HTMLButtonElement>('[data-preview-file]');
    if(previewFile){
      const index=Number(previewFile.dataset.previewFile);
      if(!Number.isInteger(index)||!this.files[index]||index===this.activeFile)return;
      this.captureOptions();this.activeFile=index;this.currentPage=1;this.workspace();
      this.root.querySelector<HTMLButtonElement>(`[data-preview-file="${index}"]`)?.focus();
      return;
    }
    const up=target.closest<HTMLElement>('[data-move-up]'),down=target.closest<HTMLElement>('[data-move-down]'),remove=target.closest<HTMLElement>('[data-remove-file]');
    if(up||down||remove){const index=Number((up??down??remove)?.dataset.moveUp??(down??remove)?.dataset.moveDown??remove?.dataset.removeFile);
      if(!Number.isInteger(index)||index<0||index>=this.files.length)return;
      this.captureOptions();this.invalidateResult();
      this.pipelineReport=null;
      if(remove){
        const [removed]=this.files.splice(index,1);
        if(removed&&!this.files.includes(removed))this.photoCorrections.delete(removed);
        if(index===this.activeFile){
          this.activeFile=Math.max(0,Math.min(index,this.files.length-1));
          this.currentPage=1;
        }else if(index<this.activeFile)this.activeFile--;
      }else {
        const next=index+(up?-1:1);
        if(next<0||next>=this.files.length)return;
        [this.files[index],this.files[next]]=[this.files[next]!,this.files[index]!];
        if(this.activeFile===index)this.activeFile=next;
        else if(this.activeFile===next)this.activeFile=index;
      }
      if(!this.files.length){this.revisions.clear();location.hash=base+this.tool!.id;return;}
      this.workspace();return;
    }
    const pagesField=this.root.querySelector<HTMLInputElement>('[data-options] input[name="pages"]');
    const selectionAction=target.closest<HTMLButtonElement>('[data-select-all-pages],[data-clear-pages]');
    if(selectionAction&&pagesField&&this.preview){
      this.selected.clear();
      if(selectionAction.hasAttribute('data-select-all-pages')){
        for(let page=1;page<=this.preview.pageCount;page++)this.selected.add(page);
      }
      this.selectionAnchor=null;
      this.commitPageSelection(pagesField);
      return;
    }
    const thumb=target.closest<HTMLElement>('[data-page]');
    if(thumb&&thumb.classList.contains('df2-thumb')){
      const p=Number(thumb.dataset.page);
      const imageExport=this.tool?.id==='pdf-to-images',visual=visualPageTools.has(this.tool?.id??'');
      if((imageExport||visual)&&pagesField){
        if(pagesField.getAttribute('aria-invalid')==='true'){
          this.message('Fix the page range or clear it before selecting thumbnails.');
          await this.showPage(p);return;
        }
        if(imageExport&&this.selected.size===1&&this.selected.has(p)){
          this.message('Keep at least one selected page. Clear the page field to export every page.');
          await this.showPage(p);return;
        }
      }
      if(pagesField){
        if(visual&&event.shiftKey&&this.selectionAnchor!==null){
          const start=Math.min(p,this.selectionAnchor),end=Math.max(p,this.selectionAnchor);
          for(let page=start;page<=end;page++)this.selected.add(page);
        }else {
          if(this.selected.has(p))this.selected.delete(p);else this.selected.add(p);
          if(visual)this.selectionAnchor=p;
        }
        this.commitPageSelection(pagesField);
      }
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
    if(target.closest('[data-signature-place]')){await this.placeSignature(false);return;}
    if(target.closest('[data-signature-type]')){await this.placeSignature(true);return;}
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
