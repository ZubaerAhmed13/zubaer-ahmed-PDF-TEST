import {expect,it} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {PDFDocument,PDFHexString,PDFName,PDFArray,decodePDFRawStream,PDFRawStream} from 'pdf-lib';
import {fillForms,inspectForms} from '../src/pdf/core';
import {normalizeEditableFields} from '../src/pdf/formFields';
import type {InputFile} from '../src/pdf/types';

async function fixture(){
  const doc=await PDFDocument.create(),page=doc.addPage([500,700]),form=doc.getForm();
  const country=form.createDropdown('Country');
  country.acroField.setOptions([{value:PDFHexString.fromText('DE'),display:PDFHexString.fromText('Germany')},{value:PDFHexString.fromText('BE'),display:PDFHexString.fromText('Belgium')}]);
  country.acroField.dict.set(PDFName.of('V'),PDFHexString.fromText('DE'));
  country.addToPage(page,{x:40,y:600,width:200,height:30});
  const list=form.createOptionList('Regions');list.enableMultiselect();
  list.acroField.setOptions(Array.from({length:12},(_,i)=>({value:PDFHexString.fromText('R'+i),display:PDFHexString.fromText('Region '+i)})));
  list.addToPage(page,{x:40,y:300,width:200,height:270});
  const editable=form.createDropdown('Editable');editable.enableEditing();
  editable.acroField.setOptions([{value:PDFHexString.fromText('DE'),display:PDFHexString.fromText('Germany')},{value:PDFHexString.fromText('BE'),display:PDFHexString.fromText('Belgium')}]);
  editable.addToPage(page,{x:40,y:200,width:200,height:30});
  const untouched=form.createTextField('constructor');untouched.setText('Leave this value');untouched.addToPage(page,{x:40,y:100,width:200,height:30});
  return {name:'codes.pdf',type:'application/pdf',buffer:(await doc.save()).buffer as ArrayBuffer};
}
function appearance(field:ReturnType<ReturnType<PDFDocument['getForm']>['getDropdown']>|ReturnType<ReturnType<PDFDocument['getForm']>['getOptionList']>,doc:PDFDocument){
  const stream=doc.context.lookup(field.acroField.getWidgets()[0]!.getAppearances()!.normal);
  expect(stream).toBeInstanceOf(PDFRawStream);
  return new TextDecoder().decode(decodePDFRawStream(stream as PDFRawStream).decode());
}
const fill=async(input:InputFile,values:Record<string,unknown>,flatten=false)=>fillForms([input],{values:JSON.stringify(values),flatten},()=>{});

it('accepts readable labels with distinct codes and preserves codes, options, flags and numerical selected indices',async()=>{
  const input=await fixture(),inspection=await inspectForms([input],{},()=>{});
  const fields=normalizeEditableFields(JSON.parse(String(inspection.info!.fields)));
  expect(fields[0]).toMatchObject({choices:['Germany','Belgium'],choiceExportValues:['DE','BE'],value:'DE'});
  const output=await fill(input,{Country:'BE',Regions:['R10','R2'],Editable:'Custom value'});
  const doc=await PDFDocument.load(output.outputs[0]!.buffer),form=doc.getForm();
  expect(form.getDropdown('Country').getSelected()).toEqual(['BE']);
  expect(form.getDropdown('Country').getOptions()).toEqual(['Germany','Belgium']);
  expect(form.getDropdown('Country').isEditable()).toBe(false);
  expect(form.getOptionList('Regions').getSelected()).toEqual(['R2','R10']);
  expect(form.getOptionList('Regions').acroField.dict.lookup(PDFName.of('I'),PDFArray).asArray().map(String)).toEqual(['2','10']);
  expect(form.getDropdown('Editable').getSelected()).toEqual(['Custom value']);
  expect(form.getDropdown('Editable').isEditable()).toBe(true);
  expect(form.getTextField('constructor').getText()).toBe('Leave this value');
  expect(appearance(form.getDropdown('Country'),doc)).toContain('<42656C6769756D>');
  mkdirSync('artifacts/form-choices',{recursive:true});writeFileSync('artifacts/form-choices/editable.pdf',new Uint8Array(output.outputs[0]!.buffer));
  const flattened=await fill(input,{Country:'BE',Regions:['R10','R2'],Editable:'DE'},true);
  const flatDoc=await PDFDocument.load(flattened.outputs[0]!.buffer);
  expect(flatDoc.catalog.has(PDFName.of('AcroForm'))).toBe(false);
  writeFileSync('artifacts/form-choices/flattened.pdf',new Uint8Array(flattened.outputs[0]!.buffer));
});

it('treats paired choice values as codes even when a label equals another option code',async()=>{
  const doc=await PDFDocument.create(),page=doc.addPage(),field=doc.getForm().createDropdown('Collision');
  field.acroField.setOptions([{value:PDFHexString.fromText('A'),display:PDFHexString.fromText('B')},{value:PDFHexString.fromText('B'),display:PDFHexString.fromText('Second')}]);field.addToPage(page);
  const output=await fill({name:'collision.pdf',type:'application/pdf',buffer:(await doc.save()).buffer as ArrayBuffer},{Collision:'B'});
  const result=await PDFDocument.load(output.outputs[0]!.buffer);
  expect(result.getForm().getDropdown('Collision').getSelected()).toEqual(['B']);
  expect(appearance(result.getForm().getDropdown('Collision'),result)).toContain('<5365636F6E64>');
});

it('rejects unknown codes and repeated selections without silently enabling editing or changing multiplicity',async()=>{
  const input=await fixture();
  await expect(fill(input,{Country:'Belgium'})).rejects.toMatchObject({code:'INVALID_FORM_VALUES'});
  await expect(fill(input,{Country:'unknown'})).rejects.toMatchObject({code:'INVALID_FORM_VALUES'});
  await expect(fill(input,{Country:['DE','BE']})).rejects.toMatchObject({code:'INVALID_FORM_VALUES'});
  await expect(fill(input,{Regions:['R2','R2']})).rejects.toMatchObject({code:'INVALID_FORM_VALUES'});
});

it('does not treat inherited property names as submitted field edits',async()=>{
  const doc=await PDFDocument.create(),page=doc.addPage(),field=doc.getForm().createTextField('constructor');field.setText('Unchanged');field.addToPage(page);
  const output=await fill({name:'names.pdf',type:'application/pdf',buffer:(await doc.save()).buffer as ArrayBuffer},{});
  expect((await PDFDocument.load(output.outputs[0]!.buffer)).getForm().getTextField('constructor').getText()).toBe('Unchanged');
});

it('retains untouched paired values and appearances while another field changes',async()=>{
  const input=await fixture(),before=await PDFDocument.load(input.buffer);
  const original=appearance(before.getForm().getDropdown('Country'),before);
  const output=await fill(input,{constructor:'Explicit value'}),after=await PDFDocument.load(output.outputs[0]!.buffer);
  expect(after.getForm().getDropdown('Country').getSelected()).toEqual(['DE']);
  expect(appearance(after.getForm().getDropdown('Country'),after)).toBe(original);
  expect(after.getForm().getTextField('constructor').getText()).toBe('Explicit value');
});

it('rejects ambiguous paired labels/codes in inspection and export',async()=>{
  for(const [labels,codes] of [[['Same','Same'],['A','B']],[['First','Second'],['A','A']],[['First','Second'],['','B']]]){
    const doc=await PDFDocument.create(),page=doc.addPage(),field=doc.getForm().createDropdown('Ambiguous');field.acroField.setOptions(labels!.map((label,i)=>({value:PDFHexString.fromText(codes![i]!),display:PDFHexString.fromText(label)})));field.addToPage(page);
    const input={name:'ambiguous.pdf',type:'application/pdf',buffer:(await doc.save()).buffer as ArrayBuffer},inspected=await inspectForms([input],{},()=>{});
    expect(()=>normalizeEditableFields(JSON.parse(String(inspected.info!.fields)))).toThrow(/cannot be mapped safely/);
    await expect(fill(input,{})).rejects.toMatchObject({code:'UNSUPPORTED_FORM'});
  }
});

it('rejects non-object form value payloads',async()=>{
  const input=await fixture();for(const values of ['null','[]','123','"text"'])await expect(fillForms([input],{values},()=>{})).rejects.toMatchObject({code:'INVALID_FORM_VALUES'});
});

it('does not produce invalid selected indices for editable multiselect dropdowns',async()=>{
  const doc=await PDFDocument.create(),page=doc.addPage(),field=doc.getForm().createDropdown('Editable multiple');field.setOptions(['Listed']);field.enableEditing();field.enableMultiselect();field.addToPage(page);
  await expect(fill({name:'multiple.pdf',type:'application/pdf',buffer:(await doc.save()).buffer as ArrayBuffer},{'Editable multiple':['Custom','Listed']})).rejects.toMatchObject({code:'UNSUPPORTED_FORM'});
});

it('clears paired selections and rebuilds missing read-only appearances using labels',async()=>{
  const input=await fixture(),doc=await PDFDocument.load(input.buffer),field=doc.getForm().getDropdown('Country');field.enableReadOnly();field.acroField.getWidgets()[0]!.dict.delete(PDFName.of('AP'));
  const missing={...input,buffer:(await doc.save({updateFieldAppearances:false})).buffer as ArrayBuffer};
  const output=await fill(missing,{Country:'BE'}),result=await PDFDocument.load(output.outputs[0]!.buffer);
  expect(result.getForm().getDropdown('Country').getSelected()).toEqual(['DE']);
  expect(appearance(result.getForm().getDropdown('Country'),result)).toContain('<4765726D616E79>');
  const cleared=await fill(input,{Country:'',Regions:[]}),empty=await PDFDocument.load(cleared.outputs[0]!.buffer);
  expect(empty.getForm().getDropdown('Country').getSelected()).toEqual([]);
  expect(empty.getForm().getOptionList('Regions').getSelected()).toEqual([]);
  expect(empty.getForm().getOptionList('Regions').acroField.dict.has(PDFName.of('I'))).toBe(false);
});

it('highlights every wrapped line of selected options without highlighting shared unselected text',async()=>{
  const doc=await PDFDocument.create(),page=doc.addPage([400,400]),field=doc.getForm().createOptionList('Wrapped');field.acroField.setOptions([{value:PDFHexString.fromText('L'),display:PDFHexString.fromText('A selected long region name')},{value:PDFHexString.fromText('U'),display:PDFHexString.fromText('A unselected long region name')}]);field.addToPage(page,{x:40,y:150,width:80,height:150});field.setFontSize(12);
  const input={name:'wrapped.pdf',type:'application/pdf',buffer:(await doc.save()).buffer as ArrayBuffer};
  for(const flatten of [false,true]){
    const output=await fill(input,{Wrapped:'L'},flatten);writeFileSync('artifacts/form-choices/wrapped-'+(flatten?'flattened':'editable')+'.pdf',new Uint8Array(output.outputs[0]!.buffer));
    if(!flatten){const result=await PDFDocument.load(output.outputs[0]!.buffer);expect(result.getForm().getOptionList('Wrapped').getSelected()).toEqual(['L']);expect((appearance(result.getForm().getOptionList('Wrapped'),result).match(/0\.6 0\.7568[^\n]+ rg/g)??[]).length).toBe(3);}
  }
});

it('retains sorted list styling and all four widget rotations with paired codes',async()=>{
  for(const rotation of [0,90,180,270])for(const paired of [false,true]){
    const doc=await PDFDocument.create(),page=doc.addPage([400,400]),field=doc.getForm().createOptionList('Styled');field.enableMultiselect();field.enableSorting();
    field.acroField.setOptions([{value:PDFHexString.fromText(paired?'Z':'Zulu'),display:PDFHexString.fromText('Zulu')},{value:PDFHexString.fromText(paired?'A':'Alpha'),display:PDFHexString.fromText('Alpha')},{value:PDFHexString.fromText(paired?'B':'Beta'),display:PDFHexString.fromText('Beta')}]);field.addToPage(page,{x:70,y:100,width:180,height:160});field.setFontSize(12);
    const widget=field.acroField.getWidgets()[0]!;widget.dict.set(PDFName.of('MK'),doc.context.obj({R:rotation,BG:[0.9,0.95,1],BC:[0.2,0.3,0.4]}));widget.setDefaultAppearance('/Helv 12 Tf 0.2 0.4 0.6 rg');
    if(!paired)field.select(['Alpha','Zulu']);
    const bytes=await doc.save();let output:ArrayBuffer=bytes.buffer as ArrayBuffer;
    if(paired){const result=await fill({name:'styled.pdf',type:'application/pdf',buffer:output},{Styled:['A','Z']});output=result.outputs[0]!.buffer;const reopened=(await PDFDocument.load(output)).getForm().getOptionList('Styled');expect(reopened.isSorted()).toBe(true);expect(reopened.getOptions()).toEqual(['Zulu','Alpha','Beta']);expect(reopened.getSelected()).toEqual(['Z','A']);}
    writeFileSync('artifacts/form-choices/style-'+rotation+'-'+(paired?'codes':'reference')+'.pdf',new Uint8Array(output));
  }
});
