import {getProcessingIdentity,processingConnection,processingProfile} from '../app/cloudSync';
import type {OperationResult} from '../pdf/types';
import {ProcessingSession} from './processingSession';
import {startRemoteProcessing} from './remoteProcessing';
import {mountProcessingAccount} from './processingAccount';

export const serverProcessingAvailable=()=>import.meta.env.VITE_DOCFLOW_SERVER_PROCESSING==='1'&&processingConnection()!==null;
/** Server controls stay interactive during uncertain cancellation so sign-in can be renewed. */
export class V2ServerProcessing{
  private disposeAccount:()=>void;
  private disposed=false;
  private readonly session:ProcessingSession;
  constructor(private readonly host:HTMLElement,private readonly form:HTMLFormElement,output:(result:OperationResult)=>void,private readonly lock:(held:boolean)=>void,private readonly status:(message:string)=>void){
    host.innerHTML=`<h3>Temporary server processing</h3><div data-processing-account></div><p>Upload this PDF to private Supabase storage for an isolated Vercel worker. This processes the whole document, up to 25 MB and 100 pages, with a 180-second worker limit. English and German are supported.</p><p>Input files are removed after processing. Outputs expire after 30 minutes; cleanup runs every five minutes. An unused signed upload link can remain valid for two hours, and cleanup also removes recreated files. This is limited staging capacity. OCR can make mistakes; review names, numbers and page appearance. Adding a text layer invalidates existing digital signatures.</p><label class="df2-check"><input name="serverDeskew" type="checkbox"> Automatically deskew scans</label><label class="df2-check"><input name="serverRotate" type="checkbox"> Automatically rotate scans</label><label class="df2-check"><input name="serverConsent" data-private-option type="checkbox"> I agree to upload this document to Supabase and Vercel for this processing attempt and to the temporary retention described above.</label><p data-server-job role="status" aria-live="polite"></p><div data-server-recovery hidden><button type="button" class="df2-btn df2-btn-outline" data-server-check>Check server status</button><button type="button" class="df2-btn df2-btn-outline" data-server-cancel>Retry server cancellation</button><button type="button" class="df2-btn df2-btn-outline" data-server-retrieve>Retrieve completed PDF</button><button type="button" class="df2-btn df2-btn-outline" data-server-release>Finish this attempt</button><p>Checking and retrieving use this same job. A new processing attempt is available only after this job is confirmed stopped. Keep this tab open while status is uncertain.</p></div>`;
    this.session=new ProcessingSession(result=>{if(!this.disposed)output(result);},()=>this.paint());
    this.disposeAccount=mountProcessingAccount(host.querySelector<HTMLElement>('[data-processing-account]')!);
    for(const action of ['check','cancel','retrieve','release'] as const)host.querySelector('[data-server-'+action+']')?.addEventListener('click',()=>{void this.act(action);});
  }
  get held():boolean{return this.session.held;}
  private paint():void{
    if(this.disposed)return;
    this.lock(this.held);
    const recovery=this.host.querySelector<HTMLElement>('[data-server-recovery]')!;recovery.hidden=!this.held;
    const message=this.host.querySelector<HTMLElement>('[data-server-job]')!;message.textContent=this.session.message+(this.session.jobId?' Job '+this.session.jobId+'.':'');
    if(this.session.message)this.status(this.session.message);
    for(const action of ['check','cancel','retrieve','release']){
      const button=this.host.querySelector<HTMLButtonElement>('[data-server-'+action+']')!;
      button.disabled=this.session.working||(action==='check'&&!this.session.canCheck)||(action==='retrieve'&&!this.session.canRetrieve)||(action==='release'&&!this.session.canRelease);
    }
    this.form.querySelector<HTMLSelectElement>('[name=processingMode]')!.disabled=this.held;
    this.host.querySelectorAll<HTMLInputElement>('[name=serverConsent],[name=serverDeskew],[name=serverRotate]').forEach(input=>{input.disabled=this.held;});
  }
  private async act(action:'check'|'cancel'|'retrieve'|'release'):Promise<void>{
    try{if(action==='release')this.session.release();else await this.session[action]();}catch{/* Session reports the exact uncertainty and retains the same job. */}
  }
  start(file:File):void{
    if(this.held)return;
    const consent=this.host.querySelector<HTMLInputElement>('[name=serverConsent]')!;
    const config=processingConnection();
    if(!serverProcessingAvailable()||!config){this.status('Server processing is not configured in this build.');return;}
    if(!processingProfile()){this.status('Sign in to DocFlow before server processing.');return;}
    if(!consent.checked){this.status('Read and accept the upload and retention notice before server processing.');return;}
    if(file.size<1||file.size>25*1024*1024){this.status('Server processing supports files up to 25 MB.');return;}
    const language=this.form.querySelector<HTMLSelectElement>('[name=language]')!.value;
    const options={languages:language==='eng+deu'?['eng','deu'] as ('eng'|'deu')[]:[language==='deu'?'deu' as const:'eng' as const],deskew:this.host.querySelector<HTMLInputElement>('[name=serverDeskew]')!.checked,rotate:this.host.querySelector<HTMLInputElement>('[name=serverRotate]')!.checked};
    consent.checked=false;
    try{this.session.begin(startRemoteProcessing(file,{operation:'ocr',options},true,config,{fetch:globalThis.fetch.bind(globalThis),identity:getProcessingIdentity,progress:message=>{if(!this.disposed)this.status(message);}}));}catch(error){this.status(error instanceof Error?error.message:'Could not start server processing.');}
  }
  cancel():Promise<void>{return this.act('cancel');}
  stopForNavigation():Promise<boolean>{return this.session.stopForNavigation();}
  dispose():void{this.disposed=true;this.disposeAccount();this.session.dispose();}
}
