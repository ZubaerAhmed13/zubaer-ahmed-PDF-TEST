import type {OperationResult} from '../pdf/types';
import type {RemoteOperation,RemoteJob,Cancellation} from './remoteProcessing';
const terminal=new Set(['cancelled','completed','failed','expired','none']);
/** One in-memory attempt owns the workspace until server status is confirmed. */
export class ProcessingSession{
  private operation:RemoteOperation|null=null;
  private generation=0;
  private settled=false;
  working=false;
  state:RemoteJob['state']|'unknown'|'none'='none';
  message='';
  constructor(private readonly output:(result:OperationResult)=>void,private readonly changed:()=>void){}
  get held():boolean{return this.operation!==null;}
  get canRelease():boolean{return this.held&&this.settled&&!this.working&&terminal.has(this.state);}
  get canCheck():boolean{return this.held&&this.settled&&!this.working;}
  get canRetrieve():boolean{return this.held&&this.settled&&!this.working&&this.state==='completed';}
  get jobId():string|null{return this.operation?.jobId()??null;}
  begin(operation:RemoteOperation):void{
    if(this.held)throw Error('Check or stop the existing server job first.');
    const generation=++this.generation;this.operation=operation;this.state='unknown';this.settled=false;this.changed();
    void operation.result.then(result=>{
      if(generation!==this.generation)return;this.settled=true;this.state='completed';this.message='Server PDF verified. Review the actual output.';this.changed();this.output(result);
    },error=>{if(generation!==this.generation)return;this.settled=true;this.message=error instanceof Error?error.message:'Server status is uncertain. Check this job before retrying.';this.changed();});
  }
  private async action<T>(work:(operation:RemoteOperation)=>Promise<T>):Promise<T>{
    if(!this.operation||this.working)throw Error('Wait for the current server action to finish.');
    this.working=true;this.changed();
    try{return await work(this.operation);}catch(error){this.message=error instanceof Error?error.message:'Server status is uncertain.';throw error;}finally{this.working=false;this.changed();}
  }
  async check():Promise<void>{if(!this.canCheck)throw Error('Wait for the original request to settle before checking recovery status.');await this.action(async operation=>{const status=await operation.check();this.state=status?.state??'none';this.message=status?'Server job: '+status.state+'.':'No server job was created.';});}
  async cancel():Promise<Cancellation>{return this.action(async operation=>{this.message='Requesting server cancellation…';this.changed();const status=await operation.cancel();this.state=status.state;this.message=status.state==='completed'?'The server finished before cancellation. Retrieve its PDF before expiry.':status.state==='cancelled'?'Server processing cancelled.':'Server job stopped: '+status.state+'.';if(status.cleanupPending)this.message+=' Temporary file cleanup is pending.';return status;});}
  async retrieve():Promise<void>{if(!this.canRetrieve)throw Error('Wait for the original download to finish and check completed status.');await this.action(async operation=>{const result=await operation.retrieve();this.state='completed';this.output(result);});}
  async stopForNavigation():Promise<boolean>{
    if(!this.held)return true;
    if(this.canRelease)return true;
    try{const status=await this.cancel();return terminal.has(status.state);}catch{return false;}
  }
  release():void{if(!this.canRelease)throw Error('Check terminal server status before starting again.');this.dispose();this.changed();}
  dispose():void{++this.generation;this.operation=null;this.state='none';this.message='';this.settled=false;}
}
