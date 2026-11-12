import {expect,it} from 'vitest';
import {PDFDocument,PDFHexString,PDFName} from 'pdf-lib';
import {inspectForms,fillForms} from '../src/pdf/core';
it('inspects actual radio exports and choice multiplicity without guessing from appearance names',async()=>{
  const doc=await PDFDocument.create(),page=doc.addPage(),form=doc.getForm(),radio=form.createRadioGroup('Numeric');radio.addOptionToPage('1',page);radio.addOptionToPage('0',page);const dropdown=form.createDropdown('Multiple');dropdown.setOptions(['A','B']);dropdown.enableMultiselect();dropdown.select(['A','B']);dropdown.addToPage(page);const list=form.createOptionList('Single');list.setOptions(['A','B']);list.addToPage(page);
  const result=await inspectForms([{name:'forms.pdf',type:'application/pdf',buffer:(await doc.save()).buffer as ArrayBuffer}],{},()=>{}),fields=JSON.parse(String(result.info!.fields));expect(fields[0].widgets.map((w:{choice:string})=>w.choice)).toEqual(['1','0']);expect(fields[1].multiSelect).toBe(true);expect(fields[2].multiSelect).toBe(false);
});
it('rejects a display label submitted as a noneditable choice code',async()=>{
  const doc=await PDFDocument.create(),page=doc.addPage(),field=doc.getForm().createDropdown('Country');field.acroField.setOptions([{value:PDFHexString.fromText('DE'),display:PDFHexString.fromText('Germany')},{value:PDFHexString.fromText('BE'),display:PDFHexString.fromText('Belgium')}]);field.acroField.dict.set(PDFName.of('V'),PDFHexString.fromText('DE'));field.addToPage(page);const input={name:'codes.pdf',type:'application/pdf',buffer:(await doc.save()).buffer as ArrayBuffer};
  await expect(fillForms([input],{values:JSON.stringify({Country:'Belgium'})},()=>{})).rejects.toMatchObject({code:'INVALID_FORM_VALUES'});
});
it('does not enable multiselect when an input requests multiple values for a single-select list',async()=>{
  const doc=await PDFDocument.create(),page=doc.addPage(),field=doc.getForm().createOptionList('Single');field.setOptions(['A','B']);field.addToPage(page);const input={name:'single.pdf',type:'application/pdf',buffer:(await doc.save()).buffer as ArrayBuffer};await expect(fillForms([input],{values:JSON.stringify({Single:['A','B']})},()=>{})).rejects.toMatchObject({code:'INVALID_FORM_VALUES'});
});
