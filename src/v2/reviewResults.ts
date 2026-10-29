import type { ComparisonResult, PageDifference } from '../pdf/pdfComparison';
import type { SearchHit } from '../pdf/textExtraction';
import {mountImageReview,type ImageReviewData} from './imageReview';

export type ReviewData =
  | {kind:'text';query:string;hits:SearchHit[];pageCount:number;scannedPages:number}
  | {kind:'compare';comparison:ComparisonResult}
  | ImageReviewData;

const label=(tag:string,value:string,cls=''):HTMLElement=>{
  const node=document.createElement(tag);node.textContent=value;
  if(cls)node.className=cls;
  return node;
};
export function mountReview(host:HTMLElement,data:ReviewData):()=>void{
  host.replaceChildren();
  host.className='df2-review';
  if(data.kind==='images')return mountImageReview(host,data);
  if(data.kind==='text'){
    host.append(label('h2','Search and extraction results'));
    const summary=data.query
      ? data.hits.reduce((sum,hit)=>sum+hit.count,0)+' matches across '+data.hits.length+' pages'
      : 'Selectable text extracted from '+data.pageCount+' pages';
    host.append(label('p',summary,'df2-review-intro'));
    if(data.scannedPages)host.append(label('p',
      data.scannedPages+' pages contained no selectable text. OCR was not performed; extracted text may be incomplete.',
      'df2-review-warning'));
    if(data.query){
      if(!data.hits.length)host.append(label('p','No matches found in the selectable text. Try OCR for image-only pages.','df2-review-intro'));
      const list=label('div','','df2-review-list');
      for(const hit of data.hits){
        const row=label('article','','df2-review-row');
        row.append(label('strong','Page '+hit.page+' · '+hit.count+' '+(hit.count===1?'match':'matches')));
        row.append(label('p',hit.sample));
        list.append(row);
      }
      host.append(list);
    }
    return ()=>{host.replaceChildren();};
  }
  const comparison=data.comparison;
  host.append(label('h2','PDF comparison review'));
  host.append(label('p',comparison.changedPages+' changed or moved page matches across '+
    comparison.pagesCompared+' compared pairs · A '+comparison.leftPages+' pages · B '+comparison.rightPages+' pages','df2-review-intro'));
  host.append(label('p',comparison.limited
    ? 'Incomplete comparison: the selected first-page limit did not cover all pages. Page matching is heuristic; inspect uncertain results.'
    : 'Page matching is heuristic and downscaled image comparison may miss small changes. Review uncertain results before making decisions.',
  'df2-review-warning'));
  const nav=label('div','','df2-review-nav'),select=document.createElement('select');
  select.setAttribute('aria-label','Compared page pairs');
  comparison.rows.forEach((row,i)=>{
    const o=document.createElement('option');o.value=String(i);
    o.textContent='A '+(row.leftPage??'—')+' ↔ B '+(row.rightPage??'—')+
      ' · '+row.status+(row.moved?' · moved':'')+(row.uncertain?' · uncertain':'');
    select.append(o);
  });
  const prior=document.createElement('button'),next=document.createElement('button');
  prior.type='button';next.type='button';prior.textContent='← Previous change';next.textContent='Next change →';
  nav.append(prior,select,next);host.append(nav);
  const detail=label('section','','df2-review-detail');
  detail.setAttribute('aria-label','Current compared page pair');
  detail.setAttribute('aria-live','polite');
  host.append(detail);
  const changed=comparison.rows.flatMap((r,i)=>r.status!=='same'||r.moved?[i]:[]);
  let index=Math.max(0,comparison.rows.findIndex(r=>r.status!=='same'||r.moved));
  let activeUrls:string[]=[];
  const clear=():void=>{activeUrls.forEach(URL.revokeObjectURL);activeUrls=[];};
  const image=(blob:Blob,description:string):HTMLElement=>{
    const figure=label('figure','','df2-review-figure');
    const src=URL.createObjectURL(blob);activeUrls.push(src);
    const picture=document.createElement('img');picture.src=src;picture.alt=description;picture.loading='lazy';
    figure.append(picture,label('figcaption',description));return figure;
  };
  const summarize=(row:PageDifference):string=>{
    const parts=['A page '+(row.leftPage??'absent')+' → B page '+(row.rightPage??'absent')];
    if(row.moved)parts.push('Moved page');
    if(row.uncertain)parts.push('Uncertain match');
    if(row.pixelDifferencePercent!==null)parts.push(row.pixelDifferencePercent+'% changed pixels');
    return parts.join(' · ');
  };
  const render=():void=>{
    clear();detail.replaceChildren();select.value=String(index);
    const row=comparison.rows[index];if(!row)return;
    prior.disabled=!changed.some(i=>i<index);
    next.disabled=!changed.some(i=>i>index);
    detail.append(label('h3',summarize(row)));
    detail.append(label('p',row.status==='same'?'No detected differences in this pair.':'Status: '+row.status,'df2-review-intro'));
    if(row.textLimited)detail.append(label('p','Word-level comparison was truncated at its supported limit.','df2-review-warning'));
    const preview=comparison.previews[index];
    if(preview){
      const gallery=label('div','','df2-review-gallery');
      gallery.append(image(preview.left,'Document A'),image(preview.right,'Document B'),image(preview.overlay,'Difference overlay'));
      detail.append(gallery);
    }
    const differences=row.changes.filter(c=>c.kind!=='same');
    if(differences.length){
      const textChanges=label('div','','df2-review-changes');
      textChanges.append(label('strong','Text changes'));
      differences.slice(0,40).forEach(c=>textChanges.append(label('p',c.kind+': '+c.text)));
      if(differences.length>40)textChanges.append(label('small','Additional changes are included in the downloadable report.'));
      detail.append(textChanges);
    }
  };
  const onSelect=():void=>{index=Number(select.value);render();};
  const onPrevious=():void=>{const previous=changed.filter(i=>i<index).at(-1);if(previous!==undefined){index=previous;render();}};
  const onNext=():void=>{const following=changed.find(i=>i>index);if(following!==undefined){index=following;render();}};
  select.addEventListener('change',onSelect);
  prior.addEventListener('click',onPrevious);
  next.addEventListener('click',onNext);
  render();
  return ()=>{
    select.removeEventListener('change',onSelect);
    prior.removeEventListener('click',onPrevious);
    next.removeEventListener('click',onNext);
    clear();host.replaceChildren();
  };
}
