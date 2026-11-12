import type {Font} from '@pdf-lib/fontkit';
import type {EditObject} from '../pdf/editModel';

let fontPromise:Promise<Font>|undefined;
export function loadEditorFont():Promise<Font>{
  return fontPromise??=(async()=>{
    const response=await fetch(import.meta.env.BASE_URL+'fonts/DocFlowSans.woff');
    if(!response.ok)throw Error('The editor font could not be loaded. Reconnect and retry.');
    const bytes=new Uint8Array(await response.arrayBuffer());
    const {default:fontkit}=await import('@pdf-lib/fontkit');return fontkit.create(bytes);
  })().catch(error=>{fontPromise=undefined;throw error;});
}

/** Exactly the glyphs/advance widths and baselines written by pdf-lib's custom-font exporter. */
export function paintEditorText(host:HTMLElement,obj:EditObject,font:Font):boolean{
  const ns='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${obj.width} ${obj.height}`);
  svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-hidden','true');
  let overflow=false;const lines=(obj.text??'').split(/\r?\n/),scale=obj.size/font.unitsPerEm;
  if(lines.length*obj.size*1.2>obj.height+.1)overflow=true;
  for(const [index,line] of lines.entries()){
    let advance=0;
    for(const glyph of font.layout(line).glyphs){
      const path=document.createElementNS(ns,'path');path.setAttribute('d',glyph.path.toSVG());
      path.setAttribute('transform',`translate(${advance*scale} ${obj.size+index*obj.size*1.2}) scale(${scale} ${-scale})`);
      path.setAttribute('fill',obj.color);svg.append(path);advance+=glyph.advanceWidth;
    }
    if(advance*scale>obj.width+.1)overflow=true;
    if([...line].some(c=>!font.hasGlyphForCodePoint(c.codePointAt(0)!)))overflow=true;
  }
  host.append(svg);host.dataset.textOverflow=String(overflow);return overflow;
}
