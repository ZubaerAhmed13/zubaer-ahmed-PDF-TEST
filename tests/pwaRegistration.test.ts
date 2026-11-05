import {afterEach,expect,it,vi} from 'vitest';
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
async function setup(readyState:string){
  vi.resetModules();const listeners=new Map<string,()=>void>(),workerEvents=new Map<string,()=>void>(),update=vi.fn(async()=>{}),registration={waiting:null,installing:null as unknown,addEventListener:(name:string,fn:()=>void)=>workerEvents.set(name,fn),update};
  const register=vi.fn(async()=>registration);vi.stubGlobal('navigator',{serviceWorker:{register,controller:null,addEventListener:vi.fn()}});vi.stubGlobal('document',{readyState});vi.stubGlobal('window',{addEventListener:(name:string,fn:()=>void)=>listeners.set(name,fn)});
  const module=await import('../src/pwa');return {register,listeners,workerEvents,registration,update,module};
}
it('registers when entry initialization finishes after the load event',async()=>{const s=await setup('complete');await s.module.registerServiceWorker();await Promise.resolve();expect(s.register).toHaveBeenCalledWith('./sw.js',{scope:'./'});expect(s.update).toHaveBeenCalledTimes(1);});
it('waits for load when the page is still initializing',async()=>{const s=await setup('loading');await s.module.registerServiceWorker();expect(s.register).not.toHaveBeenCalled();s.listeners.get('load')?.();await Promise.resolve();expect(s.register).toHaveBeenCalledTimes(1);});

it('does not announce an update for an installed worker when no worker is waiting',async()=>{
  const s=await setup('complete');const query=vi.fn(()=>null),create=vi.fn(()=>{throw Error('Unexpected update banner');});vi.stubGlobal('document',{readyState:'complete',querySelector:query,createElement:create});
  await s.module.registerServiceWorker();await Promise.resolve();const events=new Map<string,()=>void>(),worker={state:'installed',addEventListener:(name:string,fn:()=>void)=>events.set(name,fn)};
  s.registration.installing=worker;Object.assign(navigator.serviceWorker,{controller:worker});s.workerEvents.get('updatefound')?.();expect(()=>events.get('statechange')?.()).not.toThrow();expect(create).not.toHaveBeenCalled();
});
