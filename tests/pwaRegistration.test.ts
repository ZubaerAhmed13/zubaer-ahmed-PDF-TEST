import {afterEach,expect,it,vi} from 'vitest';
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
async function setup(readyState:string){
  vi.resetModules();const listeners=new Map<string,()=>void>(),update=vi.fn(async()=>{}),registration={waiting:null,addEventListener:vi.fn(),update};
  const register=vi.fn(async()=>registration);vi.stubGlobal('navigator',{serviceWorker:{register,controller:null,addEventListener:vi.fn()}});vi.stubGlobal('document',{readyState});vi.stubGlobal('window',{addEventListener:(name:string,fn:()=>void)=>listeners.set(name,fn)});
  const module=await import('../src/pwa');return {register,listeners,update,module};
}
it('registers when entry initialization finishes after the load event',async()=>{const s=await setup('complete');await s.module.registerServiceWorker();await Promise.resolve();expect(s.register).toHaveBeenCalledWith('./sw.js',{scope:'./'});expect(s.update).toHaveBeenCalledTimes(1);});
it('waits for load when the page is still initializing',async()=>{const s=await setup('loading');await s.module.registerServiceWorker();expect(s.register).not.toHaveBeenCalled();s.listeners.get('load')?.();await Promise.resolve();expect(s.register).toHaveBeenCalledTimes(1);});
