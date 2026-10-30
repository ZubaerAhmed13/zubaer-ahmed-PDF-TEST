import type {EmbeddedImage,SkippedEmbeddedImage} from '../pdf/embeddedImages';
export type ImageReviewData={kind:'images';images:EmbeddedImage[];skipped:SkippedEmbeddedImage[]};
const element=(tag:string,text:string,cls=''):HTMLElement=>{const node=document.createElement(tag);node.textContent=text;node.className=cls;return node;};
/** Keep one decoded preview and one URL active, even for a large image archive. */
export function mountImageReview(host:HTMLElement,data:ImageReviewData):()=>void{
  host.append(element('h2','Extracted images'),element('p',`${data.images.length} embedded raster images · exported as decoded PNGs`,'df2-review-intro'));
  host.append(element('p','Original compressed streams and source metadata are not preserved. Repeated placements of the same object are exported once per page.','df2-review-intro'));
  if(data.skipped.length)host.append(element('p',`${data.skipped.length} raster operations were skipped. Review the ZIP manifest for pages and reasons; this extraction is incomplete.`,'df2-review-warning'));
  const nav=element('div','','df2-review-nav'),select=document.createElement('select'),previous=document.createElement('button'),next=document.createElement('button');
  select.setAttribute('aria-label','Extracted image');previous.type=next.type='button';previous.textContent='Previous image';next.textContent='Next image';
  data.images.forEach((record,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=`Image ${i+1} · page ${record.page} · ${record.width} × ${record.height} px`;select.append(option);});
  nav.append(previous,select,next);host.append(nav);
  const detail=element('section','','df2-review-detail');detail.dataset.imageDetail='';detail.setAttribute('aria-label','Current extracted image');detail.setAttribute('aria-live','polite');host.append(detail);
  let index=0,url:string|null=null;
  const render=():void=>{
    detail.replaceChildren();if(url)URL.revokeObjectURL(url);url=null;
    const record=data.images[index];if(!record)return;
    select.value=String(index);previous.disabled=index===0;next.disabled=index===data.images.length-1;
    const figure=element('figure','','df2-review-figure'),image=document.createElement('img');
    image.width=record.width;image.height=record.height;
    url=URL.createObjectURL(record.blob);image.src=url;image.alt=`Extracted image ${index+1} from page ${record.page}`;
    figure.append(image,element('figcaption',`Page ${record.page} · ${record.width} × ${record.height} px`));
    const download=document.createElement('a');download.href=url;download.download=record.filename;download.textContent='Download this PNG';download.className='df2-btn df2-btn-outline';
    detail.append(figure,download);
  };
  const change=():void=>{index=Number(select.value);render();};
  const prior=():void=>{if(index>0){index--;render();}};
  const following=():void=>{if(index<data.images.length-1){index++;render();}};
  select.addEventListener('change',change);previous.addEventListener('click',prior);next.addEventListener('click',following);render();
  return ()=>{select.removeEventListener('change',change);previous.removeEventListener('click',prior);next.removeEventListener('click',following);if(url)URL.revokeObjectURL(url);host.replaceChildren();};
}
