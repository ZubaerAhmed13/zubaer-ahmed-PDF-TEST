import type { PageFrame, Rect } from './editModel';
import {validateNativeRaster} from './resourceBudget';
import {PdfOperationError} from './errors';
export const nativeEditError=(message='This source content cannot be edited safely.'):PdfOperationError=>new PdfOperationError('SOURCE_EDIT_UNSUPPORTED',message);

/** Check dimensions before invoking a browser's allocating image decoder. */
export function encodedImageDimensions(bytes:Uint8Array):{width:number;height:number}{
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let width=0,height=0;
  if(bytes.length>=33&&view.getUint32(0)===0x89504e47&&view.getUint32(4)===0x0d0a1a0a&&view.getUint32(8)===13&&view.getUint32(12)===0x49484452){width=view.getUint32(16);height=view.getUint32(20);}
  else if(bytes[0]===255&&bytes[1]===216){
    let offset=2;
    while(offset<bytes.length){
      if(bytes[offset++]!==255)throw nativeEditError('Invalid JPEG image header.');
      while(bytes[offset]===255)offset++;
      const marker=bytes[offset++];if(marker===undefined||marker===218||marker===217)break;
      if(marker===1||(marker>=208&&marker<=216))continue;
      if(offset+2>bytes.length)break;
      const length=view.getUint16(offset);
      if(length<2||offset+length>bytes.length)break;
      if(marker>=192&&marker<=207&&![196,200,204].includes(marker)){
        if(length<8)break;
        height=view.getUint16(offset+3);width=view.getUint16(offset+5);break;
      }
      offset+=length;
    }
    if(!width||!height)throw nativeEditError('Invalid JPEG image dimensions.');
  }else throw nativeEditError('Choose a valid PNG or JPEG image.');
  validateNativeRaster(width,height);return{width,height};
}

export interface NativeObject {
  id: string;
  page: number;
  kind: 'text' | 'image' | 'other';
  rect: Rect;
  text?: string;
  font?: string;
  editable: boolean;
  reason?: string;
}
export interface NativeInspection {
  fingerprint: string;
  page: number;
  frame: PageFrame;
  objects: NativeObject[];
}
type TextChange = { id: string; kind: 'text'; text: string; font: 'original' | 'docflow' };
type RemoveChange = { id: string; kind: 'remove' };
export interface NativeEditPlan {
  fingerprint: string;
  edits: (TextChange | RemoveChange | { id: string; kind: 'image'; data: string })[];
}
export interface NativeRaster { width: number; height: number; rgba: Uint8Array }
export interface ResolvedNativePlan {
  fingerprint: string;
  edits: (TextChange | RemoveChange | { id: string; kind: 'image'; image: NativeRaster })[];
}
export function validateNativePlan(plan: ResolvedNativePlan): void {
  if (!plan || !/^[a-f0-9]{64}$/.test(plan.fingerprint) || !Array.isArray(plan.edits) || plan.edits.length > 1000)
    throw nativeEditError('Invalid source edit plan (maximum 1,000 changes).');
  const ids = new Set<string>();
  let budget = 0;
  for (const edit of plan.edits) {
    if (!edit || !/^[1-9]\d*:(0|[1-9]\d*)$/.test(edit.id)) throw nativeEditError('Invalid source object ID.');
    if (ids.has(edit.id)) throw nativeEditError('Duplicate source object change.');
    ids.add(edit.id);
    if (edit.kind === 'text') {
      if (typeof edit.text !== 'string' || !edit.text.length || edit.text.length > 10000 || [...edit.text].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))
        throw nativeEditError('Use one line of 1–10,000 characters. Remove an object to delete its text.');
      if (edit.font !== 'original' && edit.font !== 'docflow') throw nativeEditError('Choose a supported source font.');
      budget += edit.text.length * 2;
    } else if (edit.kind === 'image') {
      const image = edit.image;
      if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width > 8192 || image.height > 8192 || image.width * image.height > 16_000_000 || !(image.rgba instanceof Uint8Array) || image.rgba.length !== image.width * image.height * 4)
        throw nativeEditError('Replacement images must be at most 16 million pixels and 8,192 pixels per side.');
      budget += image.rgba.length;
    } else if (edit.kind !== 'remove') throw nativeEditError('Unknown source edit kind.');
  }
  if (budget > 64 * 1024 * 1024) throw nativeEditError('Decoded source edits exceed the 64 MB memory budget.');
}
