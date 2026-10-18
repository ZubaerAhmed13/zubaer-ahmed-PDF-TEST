import { afterEach, expect, it, vi } from 'vitest';
import type { PDFPageProxy } from 'pdfjs-dist';
import { abortable, renderBoundedPage } from '../src/pdf/pdfCancellation';
afterEach(()=>vi.unstubAllGlobals());
it('cancels a pending PDF await independently of the dependency settling',async()=>{
  const controller=new AbortController();let stopped=false;
  const result=abortable(new Promise(()=>{}),controller.signal,()=>{stopped=true;});
  controller.abort();await expect(result).rejects.toMatchObject({name:'AbortError'});expect(stopped).toBe(true);
});
it('cancels an active renderer and releases the locally allocated canvas on rejection',async()=>{
  const canvas={width:0,height:0,getContext:()=>({})};vi.stubGlobal('document',{createElement:()=>canvas});
  let cancelled=false;
  const page={getViewport:({scale}:{scale:number})=>({width:612*scale,height:792*scale}),render:()=>({promise:new Promise(()=>{}),cancel:()=>{cancelled=true;}})} as unknown as PDFPageProxy;
  const controller=new AbortController(),result=renderBoundedPage(page,2,controller.signal);
  controller.abort();await expect(result).rejects.toMatchObject({name:'AbortError'});
  expect(cancelled).toBe(true);expect([canvas.width,canvas.height]).toEqual([1,1]);
});
