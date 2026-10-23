import {v2Tools} from './catalog';

export function mountToolSearch(onChoose:(id:string)=>void):void{
  if(document.querySelector('[data-tool-dialog]'))return;
  const trigger=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const dialog=document.createElement('dialog');dialog.className='df2-tool-dialog';dialog.dataset.toolDialog='';
  dialog.setAttribute('aria-labelledby','df2-search-title');
  dialog.innerHTML='<div class="df2-search-title"><h2 id="df2-search-title">Find a PDF tool</h2><button type="button" aria-label="Close tool search">×</button></div><label class="df2-control">Search tools<input type="search" aria-label="Find PDF tools" placeholder="Merge, edit, compress…"></label><div class="df2-search-results" role="list"></div><p class="df2-search-status" role="status"></p>';
  const input=dialog.querySelector<HTMLInputElement>('input')!,results=dialog.querySelector<HTMLElement>('.df2-search-results')!;
  const draw=()=>{
    const term=input.value.trim().toLowerCase();results.replaceChildren();
    const matches=v2Tools.filter(t=>[t.name,t.description,t.category].some(s=>s.toLowerCase().includes(term)));
    for(const tool of matches){
      const row=document.createElement('div');row.setAttribute('role','listitem');
      const button=document.createElement('button');button.type='button';button.textContent=tool.name;
      const status=document.createElement('small');status.textContent=tool.readiness==='active'?'Open tool':'Being rebuilt';button.append(status);
      button.disabled=tool.readiness!=='active';button.addEventListener('click',()=>{dialog.close();onChoose(tool.id);});
      row.append(button);results.append(row);
    }
    dialog.querySelector<HTMLElement>('[role=status]')!.textContent=matches.length?matches.length+' tools found':'No matching tools. Try another word.';
  };
  dialog.addEventListener('close',()=>{dialog.remove();if(trigger?.isConnected)trigger.focus();});
  dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dialog.close();}});
  dialog.querySelector('button')!.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  input.addEventListener('input',draw);document.body.append(dialog);draw();dialog.showModal();input.focus();
}
