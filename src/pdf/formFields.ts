export interface InspectedFormField {
  name: string;
  type: string;
  value: string;
  choices?: string[];
  selected?: string[];
  multiline?: boolean;
  multiSelect?: boolean;
  editable?: boolean;
  choiceExportValues?: string[];
  required?: boolean;
  readOnly?: boolean;
  widgets?: { page: number; rect: { x: number; y: number; width: number; height: number }; choice?: string }[];
}


const MAX_VISUAL_CHOICES=200;

export function normalizeEditableFields(source:unknown):InspectedFormField[]{
  if(Array.isArray(source)&&source.reduce((sum,item)=>sum+(item&&typeof item==='object'&&Array.isArray(item.widgets)?item.widgets.length:0),0)>1000)throw Error('This form has more than 1,000 widgets and is too complex for these controls.');
  const fields=normalizeInspectedFields(source);
  if(fields.length>250)throw Error('This form has more than 250 fields. Use a smaller form or a compatible desktop editor.');
  if(fields.some(field=>(field.choices?.length??0)>200))throw Error('A form field has more than 200 choices and cannot be edited safely here.');
  if(fields.some(field=>field.choiceExportValues?.some((value,index)=>value!==field.choices?.[index])))throw Error('Choice fields with separate display labels and export values are not yet supported. Use a compatible PDF editor.');
  if(fields.some(field=>field.editable&&field.multiSelect))throw Error('Editable multi-select dropdowns are not supported by these controls.');
  if(fields.reduce((sum,field)=>sum+(field.choices?.length??0),0)>5000||fields.reduce((sum,field)=>sum+(field.widgets?.length??0)*Math.max(1,field.choices?.length??0),0)>20000)throw Error('This form has too many combined choice controls and is too complex for this editor.');
  return fields;
}

export function normalizeInspectedFields(source: unknown): InspectedFormField[] {
  if (!Array.isArray(source)) throw new Error('Form field inspection returned an invalid list.');
  if (source.length > 5000) throw new Error('The PDF has too many form fields to inspect safely.');
  const seen = new Set<string>();
  return source.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid form field.');
    const item = value as Record<string, unknown>;
    if (typeof item.name !== 'string' || !item.name || seen.has(item.name)) throw new Error('Invalid or duplicate form field name.');
    seen.add(item.name);
    const type = typeof item.type === 'string' ? item.type : 'unknown';
    const choices = Array.isArray(item.choices)
      ? item.choices.filter((v): v is string => typeof v === 'string').slice(0, MAX_VISUAL_CHOICES + 1)
      : [];
    const selected = Array.isArray(item.selected) ? item.selected.filter((v): v is string => typeof v === 'string') : undefined;
    return {
      name: item.name, type,
      value: typeof item.value === 'string' ? item.value : '',
      choices, selected, multiline: item.multiline === true,
      ...(typeof item.required === 'boolean' ? { required: item.required } : {}),
      ...(typeof item.multiSelect === 'boolean' ? { multiSelect:item.multiSelect } : {}),
      ...(typeof item.editable === 'boolean' ? { editable:item.editable } : {}),
      ...(Array.isArray(item.choiceExportValues)?{choiceExportValues:item.choiceExportValues.filter((value):value is string=>typeof value==='string')}:{}),
      ...(typeof item.readOnly === 'boolean' ? { readOnly: item.readOnly } : {}),
      ...(Array.isArray(item.widgets) ? { widgets: item.widgets.slice(0,1000) as InspectedFormField['widgets'] } : {})
    };
  });
}

