import {beforeAll,describe,it,expect} from 'vitest';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {PDFDocument,PDFName,PDFString,PDFDict,StandardFonts,degrees,pushGraphicsState,popGraphicsState,rectangle,clip,endPath,beginMarkedContent,endMarkedContent} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {createNativePdfium,type NativePdfium} from '../src/pdf/nativePdfium';
import {frameFor} from '../src/pdf/directEdit';

let engine:NativePdfium,font:Uint8Array;
beforeAll(async()=>{await mkdir('artifacts/native-corpus',{recursive:true});engine=await createNativePdfium(new Uint8Array(await readFile('node_modules/@embedpdf/pdfium/dist/pdfium.wasm')));font=new Uint8Array(await readFile('public/native-fonts/DocFlowSourceSans.ttf'));});
const types=['invoice','CV','report','form'];
async function words(bytes:Uint8Array){
  const doc=await getDocument({data:bytes.slice(),standardFontDataUrl:new URL('../node_modules/pdfjs-dist/standard_fonts/',import.meta.url).pathname}).promise;
  try{return(await(await doc.getPage(1)).getTextContent()).items.map(v=>'str'in v?v.str:'').join(' ');}finally{await doc.destroy();}
}
describe('30-document native content preservation corpus',()=>{
  for(let index=0;index<26;index++)it(`${types[index%4]} ${index+1}: ${index<20?'standard':'embedded '+(index%2?'subset':'full')} font, rotation ${(index%4)*90}`,async()=>{
    const started=performance.now(),doc=await PDFDocument.create(),page=doc.addPage([500,700]);doc.setTitle('Preserved title '+index);doc.setAuthor('Corpus author');doc.setCreationDate(new Date('2025-01-01T00:00:00Z'));
    page.setRotation(degrees(index%4*90));if(index%3===0)page.setCropBox(15,20,470,660);
    doc.registerFontkit(fontkit);const unicode=index>=20;
    const face=unicode?await doc.embedFont(font,{subset:index%2===1}):await doc.embedFont(StandardFonts.Helvetica);
    const original=unicode?'Résumé Αθήνα Привет':`${types[index%4]} original ${index}`,replacement=unicode?'Привет Αθήνα Résumé':`${types[index%4]} updated ${index}`;
    page.drawText(original,{x:50,y:620,size:18,font:face});page.drawText('Unchanged section',{x:50,y:540,size:12});
    const note=doc.context.obj({Type:'Annot',Subtype:'Text',Rect:[50,300,75,325],Contents:PDFString.of('Preserved note')});
    const link=doc.context.obj({Type:'Annot',Subtype:'Link',Rect:[50,350,170,370],A:{S:'URI',URI:PDFString.of('https://example.com/preserved')}});
    page.node.addAnnot(doc.context.register(note));page.node.addAnnot(doc.context.register(link));
    if(index%4===3){const field=doc.getForm().createTextField('customer');field.setText('Preserved value');field.addToPage(page,{x:50,y:150,width:180,height:25});}
    const bytes=new Uint8Array(await doc.save()),before=bytes.slice(),loaded=await PDFDocument.load(bytes),frame=frameFor(loaded.getPage(0)),inspection=await engine.inspect(bytes,1,frame);
    const object=inspection.objects.find(o=>o.text===original);expect(object,'source object').toBeDefined();expect(object!.editable).toBe(true);
    const output=await engine.apply(bytes,{fingerprint:inspection.fingerprint,edits:[{id:object!.id,kind:'text',text:replacement,font:'original'}]},[frame]);
    await Promise.all([writeFile(`artifacts/native-corpus/${index}-before.pdf`,bytes),writeFile(`artifacts/native-corpus/${index}-after.pdf`,output)]);
    const actual=await words(output);expect(actual).toContain(replacement);expect(actual).not.toContain(original);expect(actual).toContain('Unchanged section');
    const saved=await PDFDocument.load(output),savedPage=saved.getPage(0);expect(frameFor(savedPage)).toEqual(frame);expect(saved.getTitle()).toBe('Preserved title '+index);expect(saved.getAuthor()).toBe('Corpus author');
    const annots=savedPage.node.Annots()!,items=annots.asArray().map(ref=>saved.context.lookup(ref,PDFDict));
    expect(items.some(v=>v.get(PDFName.of('Contents'))?.toString()==='(Preserved note)')).toBe(true);
    expect(items.some(v=>v.lookupMaybe(PDFName.of('A'),PDFDict)?.get(PDFName.of('URI'))?.toString()==='(https://example.com/preserved)')).toBe(true);
    if(index%4===3)expect(saved.getForm().getTextField('customer').getText()).toBe('Preserved value');
    expect(bytes).toEqual(before);expect(performance.now()-started).toBeLessThan(20000);
  });
  for(const mode of ['grouped','clipped','tagged','signed'] as const)it(`guards ${mode} source content without changing the input`,async()=>{
    const doc=await PDFDocument.create(),page=doc.addPage([500,700]);
    if(mode==='grouped'){
      const inner=await PDFDocument.create(),p=inner.addPage([200,100]);p.drawText('Grouped text');
      const embedded=await doc.embedPage(p);page.drawPage(embedded,{x:50,y:500});
    }else{
      if(mode==='clipped')page.pushOperators(pushGraphicsState(),rectangle(50,610,80,30),clip(),endPath());
      if(mode==='tagged')page.pushOperators(beginMarkedContent('Span'));
      page.drawText('Original source text',{x:50,y:620,size:18});
      if(mode==='clipped')page.pushOperators(popGraphicsState());
      if(mode==='tagged')page.pushOperators(endMarkedContent());
      if(mode==='signed'){
        const sig=doc.context.register(doc.context.obj({Type:'Sig',Filter:'Adobe.PPKLite',SubFilter:'adbe.pkcs7.detached',ByteRange:[0,1,2,3],Contents:PDFString.of('placeholder')}));
        const field=doc.context.register(doc.context.obj({FT:'Sig',T:PDFString.of('Signature1'),V:sig}));doc.catalog.set(PDFName.of('AcroForm'),doc.context.obj({Fields:[field]}));
      }
    }
    const bytes=new Uint8Array(await doc.save()),before=bytes.slice(),frame={x:0,y:0,width:500,height:700,rotation:0};
    if(mode==='signed')await expect(engine.inspect(bytes,1,frame)).rejects.toThrow(/signed/i);
    else{
      const inspection=await engine.inspect(bytes,1,frame),object=inspection.objects.find(o=>o.kind===(mode==='grouped'?'other':'text'))!;
      expect(object.editable).toBe(false);expect(object.reason).toMatch(mode==='grouped'?/grouped/i:mode==='clipped'?/clipped/i:/tagged/i);
      await expect(engine.apply(bytes,{fingerprint:inspection.fingerprint,edits:[{id:object.id,kind:'remove'}]},[frame])).rejects.toThrow();
    }
    expect(bytes).toEqual(before);
  });
});
