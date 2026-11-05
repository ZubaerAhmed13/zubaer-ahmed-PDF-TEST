import {expect,it} from 'vitest';
import {prepareServerInput,serverSettings} from '../src/v2/serverTools';
const type='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
it('uses strict bounded compression controls',()=>{
  expect(serverSettings('compress',{serverQuality:'79',serverDpi:'150',serverPixels:'2200'})).toEqual({operation:'compress',options:{jpegQuality:79,dpi:150,maxImagePixels:2200}});
  for(const value of [0,49,96,79.5,NaN])expect(()=>serverSettings('compress',{serverQuality:value})).toThrow(/quality/i);
  expect(()=>serverSettings('compress',{serverDpi:301})).toThrow(/DPI/);expect(()=>serverSettings('compress',{serverPixels:899})).toThrow(/dimension/i);
});
it('normalizes missing Office MIME without reading the file',()=>{
  for(const mime of ['', 'application/octet-stream']){const file=new File(['zip'],'letter.docx',{type:mime,lastModified:123});const selected=prepareServerInput(file,serverSettings('office-to-pdf',{}));expect(selected.type).toBe(type);expect(selected.name).toBe(file.name);expect(selected.lastModified).toBe(123);expect(selected.size).toBe(file.size);}
});
it('rejects unsupported, mismatched and oversized input metadata before reading',()=>{
  const settings=serverSettings('office-to-pdf',{});
  expect(()=>prepareServerInput(new File(['zip'],'macro.docm',{type}),settings)).toThrow(/extension|MIME|format/i);
  expect(()=>prepareServerInput(new File(['zip'],'letter.docx',{type:'application/pdf'}),settings)).toThrow(/MIME/i);
  const huge=new File(['x'],'huge.docx',{type});Object.defineProperty(huge,'size',{value:25*1024*1024+1});expect(()=>prepareServerInput(huge,settings)).toThrow(/size/i);
});
it('keeps OCR settings separate from compression and Office controls',()=>{
  expect(serverSettings('ocr',{language:'eng+deu',serverDeskew:true,serverRotate:false})).toEqual({operation:'ocr',options:{languages:['eng','deu'],deskew:true,rotate:false}});
  expect(serverSettings('office-to-pdf',{language:'deu',serverQuality:95})).toEqual({operation:'office-to-pdf',options:{}});
});
