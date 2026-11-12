import {loadEditorFont} from './editorText';
import {checkText} from '../pdf/directEdit';

/** Typed marks use pinned glyph paths; the PNG is the actual placed appearance. */
export async function typedSignature(value:string):Promise<string>{
  const text=value.trim();if(!text)throw Error('Enter your name or draw a signature.');if(text.length>150)throw Error('Use a signature name of at most 150 characters.');
  const font=await loadEditorFont();
  try{checkText(text);for(const char of text)if(!font.hasGlyphForCodePoint(char.codePointAt(0)!))throw Error('Unsupported glyph.');}
  catch{throw Error('This typed signature uses unsupported characters or shaping. Draw your signature instead.');}
  const canvas=document.createElement('canvas');canvas.width=720;canvas.height=210;
  try{
    const ctx=canvas.getContext('2d');if(!ctx)throw Error('Signature rendering is unavailable.');
    const run=font.layout(text),advance=run.positions.reduce((sum,p)=>sum+p.xAdvance,0),height=font.ascent-font.descent;
    const scale=Math.min(120/font.unitsPerEm,672/Math.max(1,advance),162/Math.max(1,height));
    let x=(720-advance*scale)/2;const baseline=(210-height*scale)/2+font.ascent*scale;ctx.fillStyle='#203047';
    run.glyphs.forEach((glyph,i)=>{const position=run.positions[i]!;ctx.save();ctx.translate(x+position.xOffset*scale,baseline-position.yOffset*scale);ctx.scale(scale,-scale);ctx.fill(new Path2D(glyph.path.toSVG()));ctx.restore();x+=position.xAdvance*scale;});
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let visible=false;for(let i=3;i<pixels.length;i+=4)if(pixels[i]){visible=true;break;}
    if(!visible)throw Error('Enter a visible name or draw your signature.');
    return canvas.toDataURL('image/png');
  }finally{canvas.width=canvas.height=1;}
}
