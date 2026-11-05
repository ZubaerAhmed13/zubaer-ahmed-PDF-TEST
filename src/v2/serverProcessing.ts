import {getProcessingIdentity,processingConnection,processingProfile} from '../app/cloudSync';
import type {OperationResult} from '../pdf/types';
import {ProcessingSession} from './processingSession';
import {startRemoteProcessing} from './remoteProcessing';
import {mountProcessingAccount} from './processingAccount';
import {prepareServerInput,serverSettings,type ServerOperation} from './serverTools';

export const serverProcessingAvailable=()=>import.meta.env.VITE_DOCFLOW_SERVER_PROCESSING==='1'&&processingConnection()!==null;
/** Server controls stay interactive during uncertain cancellation so sign-in can be renewed. */
export class V2ServerProcessing{
  private disposeAccount:()=>void;
  private disposed=false;
  private readonly session:ProcessingSession;
  constructor(private readonly host:HTMLElement,private readonly form:HTMLFormElement,output:(result:OperationResult)=>void,private readonly lock:(held:boolean)=>void,private readonly status:(message:string)=>void,private readonly operation:ServerOperation='ocr'){
    const description=this.operation==='office-to-pdf'?'Convert one DOCX, PPTX or XLSX document to PDF. Legacy Office formats, macros and password-protected files are unsupported. Fonts, page breaks, charts and layout may differ; review every output page.':this.operation==='compress'?'Recompress eligible document images with quality, resolution and size limits. Unsupported encodings may remain unchanged. Image detail may be reduced; review the actual output.':'Recognise English or German scans across the whole PDF. OCR can make mistakes; review names, numbers and page appearance.';
    const settings=this.operation==='ocr'?'<label class="df2-check"><input name="serverDeskew" type="checkbox"> Automatically deskew scans</label><label class="df2-check"><input name="serverRotate" type="checkbox"> Automatically rotate scans</label>':this.operation==='compress'?'<label class="df2-control">Server JPEG quality (%)<input type="number" name="serverQuality" min="50" max="95" step="1" value="85" required></label><label class="df2-control">Server image resolution (DPI)<input type="number" name="serverDpi" min="72" max="300" step="1" value="150" required></label><label class="df2-control">Server maximum image dimension (px)<input type="number" name="serverPixels" min="900" max="5000" step="1" value="2200" required></label>':'';
    host.innerHTML=`<h3>Temporary server processing</h3><div data-processing-account></div><p>${description}</p><p>Upload this document to private Supabase storage for an isolated Vercel worker. Limits: 25 MB input, 100 output pages and a 180-second worker time limit.</p><p>Input files are removed after processing. Outputs expire after 30 minutes; cleanup runs every five minutes. An unused signed upload link can remain valid for two hours, and cleanup also removes recreated files. This is limited staging capacity. PDF processing invalidates existing digital signatures.</p>${settings}<label class="df2-check"><input name="serverConsent" data-private-option type="checkbox"> I agree to upload this document to Supabase and Vercel for this processing attempt and to the temporary retention described above.</label><p data-server-job role="status" aria-live="polite"></p><div data-server-recovery hidden><button type="button" class="df2-btn df2-btn-outline" data-server-check>Check server status</button><button type="button" class="df2-btn df2-btn-outline" data-server-cancel>Retry server cancellation</button><button type="button" class="df2-btn df2-btn-outline" data-server-retrieve>Retrieve completed PDF</button><button type="button" class="df2-btn df2-btn-outline" data-server-release>Finish this attempt</button><p>Checking and retrieving use this same job. A new processing attempt is available only after this job is confirmed stopped. Keep this tab open while status is uncertain.</p></div>`;
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
    const mode=this.form.querySelector<HTMLSelectElement>('[name=processingMode]');if(mode)mode.disabled=this.held;
    this.host.querySelectorAll<HTMLInputElement>('[name]').forEach(input=>{input.disabled=this.held;});
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
    if(!this.form.reportValidity())return;
    const values:Record<string,unknown>={};
    this.form.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[name]').forEach(input=>{values[input.name]=input instanceof HTMLInputElement&&input.type==='checkbox'?input.checked:input.value;});
    try{
      const settings=serverSettings(this.operation,values),selected=prepareServerInput(file,settings);
      consent.checked=false;
      this.session.begin(startRemoteProcessing(selected,settings,true,config,{fetch:globalThis.fetch.bind(globalThis),identity:getProcessingIdentity,progress:message=>{if(!this.disposed)this.status(message);}}));
    }catch(error){this.status(error instanceof Error?error.message:'Could not start server processing.');}
  }

  cancel():Promise<void>{return this.act('cancel');}
  stopForNavigation():Promise<boolean>{return this.session.stopForNavigation();}
  dispose():void{this.disposed=true;this.disposeAccount();this.session.dispose();}
}
