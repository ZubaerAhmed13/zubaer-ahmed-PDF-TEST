import { afterEach, expect, it, vi } from 'vitest';
const loader = vi.hoisted(()=>({terminated:0,task:{promise:Promise.resolve({numPages:1}),destroy:()=>Promise.resolve()}}));
vi.mock('pdfjs-dist',()=>({getDocument:()=>loader.task,PDFWorker:class {destroy(){loader.terminated++;}}}));
import { openLocalPdf } from '../src/pdf/pdfjsPolicy';
afterEach(()=>vi.useRealTimers());
it('rejects at the deadline even when PDF.js teardown never settles',async()=>{
  vi.useFakeTimers(); loader.task={promise:new Promise(()=>{}),destroy:()=>new Promise(()=>{})};
  let outcome='pending'; void openLocalPdf(new ArrayBuffer(1)).promise.then(()=>{outcome='resolved';},()=>{outcome='rejected';});
  await vi.advanceTimersByTimeAsync(120001);
  expect(outcome).toBe('rejected');expect(loader.terminated).toBeGreaterThan(0);
});
it('rejects promptly on abort while parsing or teardown is pending',async()=>{
  loader.task={promise:new Promise(()=>{}),destroy:()=>new Promise(()=>{})};
  const abort=new AbortController();let outcome='pending';
  void openLocalPdf(new ArrayBuffer(1),abort.signal).promise.then(()=>{outcome='resolved';},error=>{outcome=error.name;});
  abort.abort();await Promise.resolve();await Promise.resolve();
  expect(outcome).toBe('AbortError');
});
it('explicitly destroying a pending load rejects its public promise',async()=>{
  loader.task={promise:new Promise(()=>{}),destroy:()=>new Promise(()=>{})};let outcome='pending';
  const task=openLocalPdf(new ArrayBuffer(1));void task.promise.catch(error=>{outcome=error.name;});
  await task.destroy();await Promise.resolve();expect(outcome).toBe('AbortError');
});
