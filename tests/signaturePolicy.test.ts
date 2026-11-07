import {describe,it,expect} from 'vitest';
import {PDFDocument} from 'pdf-lib';
import {inspectDirectEdit,applyDirectEdit} from '../src/pdf/directEdit';
async function source(signed:boolean){const pdf=await PDFDocument.create();pdf.addPage();const sig=pdf.context.obj(signed?{Type:'Sig',ByteRange:[0,10,20,30],Contents:'placeholder'}:{FT:'Sig',T:'Unsigned field'});pdf.context.register(sig);const bytes=await pdf.save();return [{name:'signature.pdf',type:'application/pdf',buffer:bytes.slice().buffer as ArrayBuffer}];}
describe('visual-signature source policy',()=>{
  it('detects existing signature dictionaries and rejects modifications in the visual-signing path',async()=>{
    const files=await source(true);expect((await inspectDirectEdit(files)).info?.hasSignatures).toBe(true);
    await expect(applyDirectEdit(files,{requireUnsigned:true,plan:{objects:[],crops:{},removedComments:[]}})).rejects.toThrow(/certificate|signature/i);
  });
  it('allows an unsigned signature field without a signature dictionary',async()=>{const files=await source(false);expect((await inspectDirectEdit(files)).info?.hasSignatures).toBe(false);});
  it('conservatively rejects a signature dictionary stored directly inside a field value',async()=>{const pdf=await PDFDocument.create();pdf.addPage();pdf.context.register(pdf.context.obj({FT:'Sig',V:{Type:'Sig',ByteRange:[0,10,20,30]}}));const bytes=await pdf.save(),files=[{name:'direct-sig.pdf',type:'application/pdf',buffer:bytes.slice().buffer as ArrayBuffer}];expect((await inspectDirectEdit(files)).info?.hasSignatures).toBe(true);});
});
