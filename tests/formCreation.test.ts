import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createFormFields } from '../src/pdf/formCreation';
import type { InputFile } from '../src/pdf/types';

async function sample(): Promise<InputFile> {
  const pdf = await PDFDocument.create();
  pdf.addPage([600, 800]); pdf.addPage([500, 700]);
  const bytes = await pdf.save();
  return { name:'form-input.pdf',type:'application/pdf',
    buffer:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer };
}
const fields = [
  {type:'text',name:'Customer',page:1,left:15,top:15,width:40,height:7,required:true},
  {type:'checkbox',name:'Approved',page:2,left:12,top:30,width:5,height:5,required:false},
  {type:'dropdown',name:'Country',page:2,left:20,top:40,width:32,height:8,required:false,choices:['DE','BE','NL']}
];

describe('actual AcroForm field creation',()=>{
  it('writes editable widgets to the requested pages, retaining source structure',async()=>{
    const result=await createFormFields([await sample()],{fieldDefinitions:JSON.stringify(fields)},()=>{});
    expect(result.outputs).toHaveLength(1);
    const saved=await PDFDocument.load(result.outputs[0]!.buffer);
    expect(saved.getPageCount()).toBe(2);
    const form=saved.getForm();
    expect(form.getFields().map(field=>field.getName())).toEqual(['Customer','Approved','Country']);
    expect(form.getTextField('Customer').isRequired()).toBe(true);
    expect(form.getCheckBox('Approved').isChecked()).toBe(false);
    expect(form.getDropdown('Country').getOptions()).toEqual(['DE','BE','NL']);
    const rectangle=form.getTextField('Customer').acroField.getWidgets()[0]!.getRectangle();
    expect(rectangle.x).toBeGreaterThan(88); expect(rectangle.x).toBeLessThan(92);
    expect(rectangle.y).toBeGreaterThan(622); expect(rectangle.y).toBeLessThan(626);
    expect(rectangle.width).toBeGreaterThan(238); expect(rectangle.width).toBeLessThan(242);
  });
  it('rejects duplicates, invalid placement and impossible page positions',async()=>{
    const file=await sample();
    await expect(createFormFields([file],{fieldDefinitions:JSON.stringify([fields[0],fields[0]])},()=>{}))
      .rejects.toThrow(/unique/i);
    await expect(createFormFields([file],{fieldDefinitions:JSON.stringify([{...fields[0],left:90}])},()=>{}))
      .rejects.toThrow(/placement/i);
    await expect(createFormFields([file],{fieldDefinitions:JSON.stringify([{...fields[0],page:3}])},()=>{}))
      .rejects.toThrow(/does not exist/i);
  });
});
