import {PDFDropdown,PDFOptionList,PDFHexString,PDFName,defaultDropdownAppearanceProvider,type PDFFont} from 'pdf-lib';
import {formChoiceOptions} from './formFields';
import {choiceListAppearance} from './formChoiceAppearance';
import {PdfOperationError} from './errors';

type ChoiceField=PDFDropdown|PDFOptionList;
export function pdfChoiceOptions(field:ChoiceField):{label:string;value:string}[]{
  if(field instanceof PDFDropdown&&field.isEditable()&&field.isMultiselect())throw new PdfOperationError('UNSUPPORTED_FORM','Editable multi-select dropdowns are not supported by these controls.');
  const options=field.acroField.getOptions();
  try{return formChoiceOptions({choices:options.map(option=>(option.display??option.value).decodeText()),choiceExportValues:options.map(option=>option.value.decodeText())});}
  catch(error){throw new PdfOperationError('UNSUPPORTED_FORM',error instanceof Error?error.message:'Unsupported choice mapping.');}
}

export function setPdfChoiceValues(field:ChoiceField,selected:string[]):void{
  const choices=pdfChoiceOptions(field),editable=field instanceof PDFDropdown&&field.isEditable();
  if(new Set(selected).size!==selected.length||selected.length>1&&!field.isMultiselect())throw new PdfOperationError('INVALID_FORM_VALUES','This field does not allow the requested repeated/multiple selections: '+field.getName());
  if(selected.some(value=>!choices.some(choice=>choice.value===value))&&!editable)throw new PdfOperationError('INVALID_FORM_VALUES','Choose a listed option for '+field.getName());
  // pdf-lib's setValues validates against display labels and writes lexically
  // sorted indices. Write the spec's codes and numerical indices directly.
  const indexed=selected.map(value=>({value,index:choices.findIndex(choice=>choice.value===value)})).sort((a,b)=>a.index-b.index);
  const values=indexed.map(({value})=>PDFHexString.fromText(value)),dict=field.acroField.dict;
  if(!values.length)dict.delete(PDFName.of('V'));
  else dict.set(PDFName.of('V'),values.length===1?values[0]!:dict.context.obj(values));
  if(values.length>1)dict.set(PDFName.of('I'),dict.context.obj(indexed.map(item=>item.index)));
  else dict.delete(PDFName.of('I'));
}

/** Render labels without ever temporarily changing the actual /V codes. */
export function updatePdfChoiceAppearance(field:ChoiceField,font:PDFFont):void{
  const choices=pdfChoiceOptions(field),labels=field.getSelected().map(value=>choices.find(choice=>choice.value===value)?.label??value);
  if(field instanceof PDFDropdown){
    const view=Object.create(field) as PDFDropdown;view.getSelected=()=>labels;
    field.updateAppearances(font,(_source,widget,appearanceFont)=>defaultDropdownAppearanceProvider(view,widget,appearanceFont));
  }else{
    field.updateAppearances(font,(_source,widget,appearanceFont)=>choiceListAppearance(field,widget,appearanceFont,choices));
  }
}
