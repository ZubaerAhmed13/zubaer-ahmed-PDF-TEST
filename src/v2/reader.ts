import {TextLayer} from 'pdfjs-dist';
import {renderedPage} from '../pdf/render';

/** Text selection uses the bounded canvas renderer's exact page and viewport. */
export class V2Reader {
  private layer=document.createElement('div');
  private text:TextLayer|null=null;
  private generation=0;
  private disposed=false;
  constructor(private canvas:HTMLCanvasElement,paper:HTMLElement,private status:HTMLElement){
    this.layer.className='df2-reader-text';this.layer.dataset.readerLayer='';this.layer.setAttribute('role','group');this.layer.setAttribute('aria-label','Selectable PDF page text');paper.append(this.layer);
    canvas.addEventListener('docflow-page-rendered',this.rendered);void this.render();
  }
  private rendered=():void=>{void this.render();};
  clear():void{++this.generation;this.text?.cancel();this.text=null;this.layer.replaceChildren();this.layer.hidden=true;}
  private async render():Promise<void>{
    if(this.disposed)return;
    this.clear();const generation=this.generation,detail=renderedPage(this.canvas);if(!detail)return;
    this.status.textContent='Preparing text selection…';
    try{
      this.layer.style.setProperty('--scale-factor',String(detail.viewport.scale));
      const text=new TextLayer({textContentSource:detail.page.streamTextContent(),container:this.layer,viewport:detail.viewport});this.text=text;
      await text.render();if(this.disposed||generation!==this.generation)return;
      this.layer.hidden=false;
      this.status.textContent=text.textContentItemsStr.some(s=>s.trim())?'Select text directly on the page. Your original PDF is unchanged.':'This page has no selectable text. OCR is needed to recognise text in a scan.';
    }catch(error){if(!this.disposed&&generation===this.generation)this.status.textContent=error instanceof Error?'Text selection unavailable: '+error.message:'Text selection is unavailable on this page.';}
  }
  dispose():void{if(this.disposed)return;this.disposed=true;this.clear();this.canvas.removeEventListener('docflow-page-rendered',this.rendered);this.layer.remove();}
}
