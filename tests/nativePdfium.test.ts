import {beforeAll,describe,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {PDFDocument,PDFName,PDFNumber,PDFRawStream,StandardFonts,decodePDFRawStream,rgb,BlendMode,beginMarkedContent,endMarkedContent,pushGraphicsState,popGraphicsState,beginText,endText,setFontAndSize,moveText,setTextRenderingMode,showText} from 'pdf-lib';
import {getDocument,OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {createNativePdfium,type NativePdfium} from '../src/pdf/nativePdfium';
import type {ResolvedNativePlan} from '../src/pdf/nativeModel';
import {normalizePdfError} from '../src/pdf/errors';

const frame={x:0,y:0,width:500,height:700,rotation:0};
let engine:NativePdfium;
beforeAll(async()=>{engine=await createNativePdfium(new Uint8Array(await readFile('node_modules/@embedpdf/pdfium/dist/pdfium.wasm')));});
async function source(){
  const d=await PDFDocument.create(),p=d.addPage([500,700]),font=await d.embedFont(StandardFonts.Helvetica);
  p.drawText('Original source text',{x:50,y:620,size:18,font});p.drawText('Keep other content',{x:50,y:540,size:14,font});
  p.drawRectangle({x:40,y:100,width:120,height:45,color:rgb(.2,.4,.7)});
  return new Uint8Array(await d.save());
}
async function text(bytes:Uint8Array){
  const doc=await getDocument({data:bytes.slice(),standardFontDataUrl:new URL('../node_modules/pdfjs-dist/standard_fonts/',import.meta.url).pathname}).promise;
  try{return (await(await doc.getPage(1)).getTextContent()).items.map(item=>'str'in item?item.str:'').join(' ');}finally{await doc.destroy();}
}

describe('real PDFium source content editing',()=>{
  for(const state of ['opacity','blend','marked','text-clip'] as const)it(`guards image ${state} instead of discarding original graphics or accessibility state`,async()=>{
    const doc=await PDFDocument.create(),page=doc.addPage([500,700]),font=await doc.embedFont(StandardFonts.Helvetica);
    const png=await doc.embedPng(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3foAAAAASUVORK5CYII=','base64'));
    page.drawRectangle({x:0,y:0,width:500,height:700,color:rgb(0,0,0)});
    if(state==='marked')page.pushOperators(beginMarkedContent('Figure'));
    if(state==='text-clip'){
      const key=page.node.newFontDictionary(font.name,font.ref);
      page.pushOperators(pushGraphicsState(),beginText(),setFontAndSize(key,100),moveText(50,400),setTextRenderingMode(7),showText(font.encodeText('CLIP')),endText());
    }
    page.drawImage(png,{x:0,y:0,width:500,height:700,...(state==='opacity'?{opacity:.2}:state==='blend'?{blendMode:BlendMode.Multiply}:{})});
    if(state==='marked')page.pushOperators(endMarkedContent());
    if(state==='text-clip')page.pushOperators(popGraphicsState());
    const bytes=new Uint8Array(await doc.save()),before=bytes.slice(),inspection=await engine.inspect(bytes,1,frame),image=inspection.objects.find(o=>o.kind==='image')!;
    expect(image.editable).toBe(false);expect(image.reason).toMatch(/transparency|blend|tagged|clipped/i);
    await expect(engine.apply(bytes,{fingerprint:inspection.fingerprint,edits:[{id:image.id,kind:'remove'}]},[frame])).rejects.toThrow();expect(bytes).toEqual(before);
  });
  it('replaces the source text object and independently reopens selectable replacement text',async()=>{
    const bytes=await source(),before=bytes.slice(),inspection=await engine.inspect(bytes,1,frame);
    const original=inspection.objects.find(o=>o.text==='Original source text')!;
    expect(original.editable).toBe(true);expect(original.kind).toBe('text');expect(original.rect.width).toBeGreaterThan(20);
    const output=await engine.apply(bytes,{fingerprint:inspection.fingerprint,edits:[{id:original.id,kind:'text',text:'Updated source text',font:'original'}]},[frame]);
    const actual=await text(output);expect(actual).toContain('Updated source text');expect(actual).not.toContain('Original source text');expect(actual).toContain('Keep other content');
    expect(bytes).toEqual(before);expect((await PDFDocument.load(output)).getPage(0).getWidth()).toBe(500);
  });
  it('rejects stale fingerprints, duplicate IDs and a wrong object kind instead of returning partial output',async()=>{
    const bytes=await source(),before=bytes.slice(),inspection=await engine.inspect(bytes,1,frame),obj=inspection.objects.find(o=>o.kind==='text')!;
    const change={id:obj.id,kind:'text' as const,text:'Changed',font:'original' as const};
    await expect(engine.apply(bytes,{fingerprint:'0'.repeat(64),edits:[change]},[frame])).rejects.toThrow(/source|fingerprint/i);
    await expect(engine.apply(bytes,{fingerprint:inspection.fingerprint,edits:[change,change]},[frame])).rejects.toThrow(/duplicate/i);
    await expect(engine.apply(bytes,{fingerprint:inspection.fingerprint,edits:[change,{id:'1:999',kind:'remove'}]},[frame])).rejects.toThrow(/object|exist/i);
    await expect(engine.apply(bytes,{fingerprint:inspection.fingerprint,edits:[{id:obj.id,kind:'image',image:{width:1,height:1,rgba:new Uint8Array([0,255,0,255])}}]},[frame])).rejects.toThrow(/image|kind|type/i);
    expect(bytes).toEqual(before);expect(await text(bytes)).toContain('Original source text');
  });
  it('removes the selected actual source object while retaining other content',async()=>{
    const bytes=await source(),inspection=await engine.inspect(bytes,1,frame),obj=inspection.objects.find(o=>o.text==='Original source text')!;
    const output=await engine.apply(bytes,{fingerprint:inspection.fingerprint,edits:[{id:obj.id,kind:'remove'}]},[frame]);
    expect(await text(output)).not.toContain('Original source text');expect(await text(output)).toContain('Keep other content');
  });
  it('requires explicit font substitution and saves selectable Latin, Greek and Cyrillic',async()=>{
    const bytes=await source(),inspection=await engine.inspect(bytes,1,frame),obj=inspection.objects.find(o=>o.text==='Original source text')!;
    const replacement='Résumé Αθήνα Привет';
    await expect(engine.apply(bytes,{fingerprint:inspection.fingerprint,edits:[{id:obj.id,kind:'text',text:replacement,font:'original'}]},[frame])).rejects.toThrow(/font|encode/);
    const font=new Uint8Array(await readFile('public/native-fonts/DocFlowSourceSans.ttf'));
    const output=await engine.apply(bytes,{fingerprint:inspection.fingerprint,edits:[{id:obj.id,kind:'text',text:replacement,font:'docflow'}]},[frame],font);
    expect(await text(output)).toContain(replacement);expect(await text(output)).not.toContain('Original source text');expect(await text(output)).toContain('Keep other content');
    await expect(engine.apply(bytes,{fingerprint:inspection.fingerprint,edits:[{id:obj.id,kind:'text',text:'你好',font:'docflow'}]},[frame],font)).rejects.toThrow(/script|font|character/);
    const unsupported=await engine.apply(bytes,{fingerprint:inspection.fingerprint,edits:[{id:obj.id,kind:'text',text:'你好',font:'docflow'}]},[frame],font).catch(normalizePdfError);
    expect(unsupported).toMatchObject({code:'SOURCE_EDIT_UNSUPPORTED',message:expect.stringMatching(/script/)});
  });
  it('preserves text effects with the original object and rejects substitution that would lose them',async()=>{
    const doc=await PDFDocument.create(),page=doc.addPage([500,700]);page.drawText('Original source text',{x:50,y:620,size:18,opacity:.2});
    const bytes=new Uint8Array(await doc.save()),inspection=await engine.inspect(bytes,1,frame),object=inspection.objects.find(o=>o.kind==='text')!;
    expect(object.editable).toBe(true);
    const output=await engine.apply(bytes,{fingerprint:inspection.fingerprint,edits:[{id:object.id,kind:'text',text:'Updated source text',font:'original'}]},[frame]);expect(await text(output)).toContain('Updated source text');
    const font=new Uint8Array(await readFile('public/native-fonts/DocFlowSourceSans.ttf'));
    await expect(engine.apply(bytes,{fingerprint:inspection.fingerprint,edits:[{id:object.id,kind:'text',text:'Résumé',font:'docflow'}]},[frame],font)).rejects.toThrow(/transparency|blend/);
  });
  it('replaces one shared image occurrence while retaining the other image object',async()=>{
    const doc=await PDFDocument.create(),p=doc.addPage([500,700]);
    const png=await doc.embedPng(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3foAAAAASUVORK5CYII=','base64'));
    p.drawImage(png,{x:40,y:200,width:100,height:100});p.drawImage(png,{x:240,y:200,width:100,height:100});p.drawText('Keep selectable text',{x:40,y:600});
    const bytes=new Uint8Array(await doc.save()),inspection=await engine.inspect(bytes,1,frame),images=inspection.objects.filter(o=>o.kind==='image');
    expect(images).toHaveLength(2);
    const rgba=new Uint8Array(4*4*4);for(let i=0;i<rgba.length;i+=4){rgba[i]=255;rgba[i+3]=255;}
    const plan:ResolvedNativePlan={fingerprint:inspection.fingerprint,edits:[{id:images[0]!.id,kind:'image',image:{width:4,height:4,rgba}}]};
    const output=await engine.apply(bytes,plan,[frame]),after=await engine.inspect(output,1,frame);
    expect(after.objects.filter(o=>o.kind==='image').map(o=>o.rect)).toEqual(images.map(o=>o.rect));
    const saved=await PDFDocument.load(output),streams=saved.context.enumerateIndirectObjects().map(([,v])=>v).filter(v=>v instanceof PDFRawStream&&v.dict.get(PDFName.of('Subtype'))?.toString()==='/Image') as PDFRawStream[];
    const changed=streams.find(v=>v.dict.lookup(PDFName.of('Width'),PDFNumber).asNumber()===4&&v.dict.get(PDFName.of('ColorSpace'))?.toString()==='/DeviceRGB');
    expect(changed).toBeDefined();expect(streams.some(v=>v.dict.lookup(PDFName.of('Width'),PDFNumber).asNumber()===1)).toBe(true);
    expect([...decodePDFRawStream(changed!).decode().slice(0,3)]).toEqual([255,0,0]);
    const independent=await getDocument({data:output.slice(),standardFontDataUrl:new URL('../node_modules/pdfjs-dist/standard_fonts/',import.meta.url).pathname}).promise;
    try{
      const page=await independent.getPage(1),operators=await page.getOperatorList();
      const images=await Promise.all(operators.fnArray.flatMap((op,i)=>op===OPS.paintImageXObject?[new Promise<{width:number;height:number}>(resolve=>page.objs.get(operators.argsArray[i][0],resolve))]:[]));
      expect(images.map(image=>[image.width,image.height])).toEqual([[4,4],[1,1]]);
    }finally{await independent.destroy();}
    expect(await text(output)).toContain('Keep selectable text');
  });
});
