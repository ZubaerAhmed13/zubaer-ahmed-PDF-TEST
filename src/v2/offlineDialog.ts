import {mountOfflinePanel} from '../app/offline';
import {mountDiagnostics} from '../app/diagnostics';

/** Static application assets only; closing cancels incomplete preparation. */
export function openOfflineDialog(trigger:HTMLElement|null):void{
  if(document.querySelector('[data-df2-offline]'))return;
  const dialog=document.createElement('dialog');dialog.className='df2-offline-dialog';dialog.dataset.df2Offline='';dialog.setAttribute('aria-label','Offline and storage');
  const close=document.createElement('button');close.type='button';close.textContent='Close';close.setAttribute('aria-label','Close offline and storage');close.className='df2-offline-close';
  const host=document.createElement('div');dialog.append(close,host);document.body.append(dialog);
  const dispose=mountOfflinePanel(host);
  const diagnostics=document.createElement('details');diagnostics.className='df2-diagnostics';
  const summary=document.createElement('summary');summary.textContent='Diagnostics report';
  const report=document.createElement('div');diagnostics.append(summary,report);dialog.append(diagnostics);
  let disposeReport:(()=>void)|undefined;
  diagnostics.addEventListener('toggle',()=>{if(diagnostics.open&&!disposeReport)disposeReport=mountDiagnostics(report);});
  const help=host.querySelector('details');
  const paragraphs=help?.querySelectorAll('p');
  if(paragraphs?.[0])paragraphs[0].textContent='Use your browser’s Add to Home Screen or Install action if available. Choose files with the device picker. Page and zoom controls remain available on a phone; Options opens the tool settings. Server processing always needs a connection and separate upload consent.';
  if(paragraphs?.[1])paragraphs[1].textContent='Download saves a copy. Keep this tab open and export before switching apps for a long time: the operating system can discard background tabs. Prepared application files are not document backups.';
  close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{disposeReport?.();dispose();dialog.remove();const focus=trigger?.isConnected?trigger:document.querySelector<HTMLElement>('[data-open-offline]');focus?.focus({preventScroll:true});},{once:true});
  dialog.showModal();close.focus();
}
