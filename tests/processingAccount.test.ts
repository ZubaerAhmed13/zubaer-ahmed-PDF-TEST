import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const id='10000000-0000-4000-8000-000000000001',key='docflow.cloud-session.v1';
let storage:Map<string,string>;
const session=(expires=3600)=>({access_token:'test-access',refresh_token:'test-refresh',expires_in:expires,user:{id,email:'reader@example.invalid'}});
beforeEach(()=>{vi.resetModules();vi.stubEnv('VITE_SUPABASE_URL','https://project.supabase.co');vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY','sb_publishable_test');storage=new Map();vi.stubGlobal('sessionStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)});});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('reuses a tab session without saving the password',async()=>{
  const fetcher=vi.fn(async()=>Response.json(session()));vi.stubGlobal('fetch',fetcher);const auth=await import('../src/app/cloudSync');
  await auth.signInForProcessing('reader@example.invalid','test-password');expect(await auth.getProcessingIdentity()).toEqual({id,accessToken:'test-access'});expect(auth.processingProfile()?.email).toBe('reader@example.invalid');
  expect(storage.get(key)).not.toContain('test-password');expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0]?.[1]).toMatchObject({credentials:'omit',redirect:'error'});
});
it('clears the tab session even when remote sign-out fails',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(session())));const auth=await import('../src/app/cloudSync');await auth.signInForProcessing('reader@example.invalid','test-password');
  vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('offline');}));await auth.signOutForProcessing();expect(auth.processingProfile()).toBeNull();await expect(auth.getProcessingIdentity()).rejects.toThrow(/sign in/i);
});
it('refreshes an expired session',async()=>{
  storage.set(key,JSON.stringify({...session(),expires_at:0}));const fetcher=vi.fn(async()=>Response.json(session()));vi.stubGlobal('fetch',fetcher);
  const auth=await import('../src/app/cloudSync');expect((await auth.getProcessingIdentity()).accessToken).toBe('test-access');expect(String(fetcher.mock.calls[0]?.[0])).toContain('refresh_token');
});
it('does not restore a signed-out session when an earlier refresh completes',async()=>{
  storage.set(key,JSON.stringify({...session(),expires_at:0}));let finish:(r:Response)=>void=()=>{};
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.includes('refresh_token')?new Promise<Response>(r=>{finish=r;}):new Response(null,{status:204})));
  const auth=await import('../src/app/cloudSync');const pending=auth.getProcessingIdentity();await auth.signOutForProcessing();finish(Response.json(session()));
  await expect(pending).rejects.toThrow(/changed|sign in/i);expect(auth.processingProfile()).toBeNull();
});
