import {expect,it} from 'vitest';
import {ProcessingSession} from '../src/v2/processingSession';
import type {RemoteOperation} from '../src/v2/remoteProcessing';
const completed={outputs:[{name:'result.pdf',type:'application/pdf',buffer:new ArrayBuffer(8)}]};
function setup(){
  let reject:(e:Error)=>void=()=>{},resolve:(r:typeof completed)=>void=()=>{},cancels=0,fail=true;
  const result=new Promise<typeof completed>((a,b)=>{resolve=a;reject=b;});
  const operation:RemoteOperation={result,requestKey:'key',jobId:()=>null,check:async()=>({id:'job',state:'completed',phase:'done'}),retrieve:async()=>completed,cancel:async()=>{cancels++;if(fail)throw Error('not confirmed');return {state:'cancelled',cleanupPending:false};}};
  let results=0;const session=new ProcessingSession(()=>{results++;},()=>{});session.begin(operation);
  return {session,reject,resolve,results:()=>results,cancels:()=>cancels,allowCancel:()=>{fail=false;}};
}
it('retains an uncertain session and prevents a second start',async()=>{
  const s=setup();s.reject(Error('offline'));await Promise.resolve();expect(s.session.held).toBe(true);expect(()=>s.session.begin({} as RemoteOperation)).toThrow(/existing/i);
  expect(await s.session.stopForNavigation()).toBe(false);expect(s.session.held).toBe(true);
});
it('allows retrying cancellation before navigation and ignores late output after disposal',async()=>{
  const s=setup();expect(await s.session.stopForNavigation()).toBe(false);s.allowCancel();expect(await s.session.stopForNavigation()).toBe(true);expect(s.cancels()).toBe(2);
  s.session.dispose();s.resolve(completed);await Promise.resolve();expect(s.results()).toBe(0);
});
it('retrieves completed output without beginning another operation',async()=>{
  const s=setup();s.reject(Error('download interrupted'));await Promise.resolve();await s.session.check();expect(s.session.state).toBe('completed');await s.session.retrieve();expect(s.results()).toBe(1);
});
it('only releases the session after terminal status is confirmed',async()=>{
  const s=setup();s.reject(Error('offline'));await Promise.resolve();expect(()=>s.session.release()).toThrow(/check|terminal/i);await s.session.check();s.session.release();expect(s.session.held).toBe(false);
});
it('does not retrieve concurrently with the original download',async()=>{
  const s=setup();await expect(s.session.check()).rejects.toThrow(/wait/i);await expect(s.session.retrieve()).rejects.toThrow(/wait|download/i);expect(s.results()).toBe(0);s.session.dispose();s.resolve(completed);
});
it('cannot release an uncertain creation using a check made before creation settled',async()=>{
  const s=setup();await expect(s.session.check()).rejects.toThrow(/wait|settle/i);s.reject(Error('Server cancellation is not confirmed.'));await Promise.resolve();expect(s.session.canRelease).toBe(false);expect(()=>s.session.release()).toThrow(/terminal/i);
});
