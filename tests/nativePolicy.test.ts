import {describe,it,expect} from 'vitest';
import {PDFDocument,PDFName} from 'pdf-lib';
import {inspectNativeContent} from '../src/pdf/nativeEditing';

describe('native editor source policy before engine allocation',()=>{
  it('rejects certification structures even without an ordinary signature field',async()=>{
    const doc=await PDFDocument.create();doc.addPage([500,700]);
    doc.catalog.set(PDFName.of('Perms'),doc.context.obj({DocMDP:doc.context.register(doc.context.obj({Type:'Sig',TransformMethod:'DocMDP'}))}));
    const buffer=(await doc.save()).slice().buffer,before=new Uint8Array(buffer).slice();
    await expect(inspectNativeContent([{name:'certified.pdf',type:'application/pdf',buffer}],{page:1})).rejects.toThrow(/certified/);
    expect(new Uint8Array(buffer)).toEqual(before);
  });
  it('rejects custom page units before deriving source hit boxes',async()=>{
    const doc=await PDFDocument.create(),page=doc.addPage([500,700]);page.node.set(PDFName.of('UserUnit'),doc.context.obj(2));
    await expect(inspectNativeContent([{name:'scaled.pdf',type:'application/pdf',buffer:(await doc.save()).slice().buffer}],{page:1})).rejects.toThrow(/scale/);
  });
});
