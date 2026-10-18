import { afterEach, expect, it, vi } from 'vitest';
import { fitRaster, validateInputBudget, SAFE_PDF_OPTIONS } from '../src/pdf/resourceBudget';
import { runWorkerOperation } from '../src/pdf/workerClient';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('caps adaptive canvases, rejects invalid geometry and retains normal 300-DPI exports', () => {
  expect(fitRaster(612,792,300/72).scale).toBe(300/72);
  const huge = fitRaster(14400,14400,4);
  expect(huge.width*huge.height).toBeLessThanOrEqual(16000000);
  expect(Math.max(huge.width,huge.height)).toBeLessThanOrEqual(8192);
  for (const dimensions of [[NaN,100],[Infinity,1],[0,200],[-1,100],[20000,100]]) expect(() => fitRaster(dimensions[0]!,dimensions[1]!,1)).toThrow();
});
it('rejects byte budgets before a worker is created and disables PDF action execution paths', () => {
  expect(() => validateInputBudget([151*1048576])).toThrow(/150 MB/);
  expect(() => validateInputBudget([140*1048576,140*1048576])).toThrow(/250 MB/);
  expect(SAFE_PDF_OPTIONS.isEvalSupported).toBe(false);
  expect(SAFE_PDF_OPTIONS.enableXfa).toBe(false);
  expect(SAFE_PDF_OPTIONS.stopAtErrors).toBe(true);
});
it('terminates timed-out workers and ignores late completion after cancellation', async () => {
  vi.useFakeTimers();
  const workers: { terminated:boolean; emit:(value:unknown)=>void }[] = [];
  vi.stubGlobal('Worker', class {
    terminated=false; listeners: Record<string,(event:unknown)=>void>={};
    constructor(){workers.push(this);}
    emit(value:unknown){this.listeners.message?.({data:value});}
    addEventListener(name:string,callback:(event:unknown)=>void){this.listeners[name]=callback;}
    postMessage(){} terminate(){this.terminated=true;}
  });
  const timed = runWorkerOperation('rotate',[],{},()=>{});
  const timeoutAssertion = expect(timed.result).rejects.toThrow(/time limit/i);
  await vi.advanceTimersByTimeAsync(120001); await timeoutAssertion;
  expect(workers[0]!.terminated).toBe(true);
  const cancelled = runWorkerOperation('rotate',[],{},()=>{});
  const rejection = expect(cancelled.result).rejects.toMatchObject({name:'AbortError'});
  cancelled.cancel(); await rejection;
  workers[1]!.emit({type:'result',result:{outputs:[]}});
  expect(workers[1]!.terminated).toBe(true);
});
