import {
  adjustDimsForRotation,componentsToColor,cmyk,drawOptionList,grayscale,
  layoutMultilineText,reduceRotation,rgb,rotateInPlace,setFillingColor,setFontAndSize,TextAlignment,
  type Color,type PDFFont,type PDFOperator,type PDFOptionList,type PDFWidgetAnnotation,type TextPosition,
} from 'pdf-lib';

// Use the public rendering primitives while keeping selection tied to option
// identity. Comparing wrapped line text to the selected label loses highlights
// and can incorrectly highlight identical fragments of another option.
function defaultStyle(target:{getDefaultAppearance():string|undefined}):{fontSize?:number;color?:Color}{
  const tokens=(target.getDefaultAppearance()??'').replace(/%[^\r\n]*/g,'').trim().split(/\s+/),style:{fontSize?:number;color?:Color}={};
  const numbers=(end:number,count:number):number[]|undefined=>{
    const raw=tokens.slice(end-count,end);if(raw.length!==count||raw.some(token=>!(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(token))))return;
    const values=raw.map(Number);return values.every(Number.isFinite)?values:undefined;
  };
  tokens.forEach((token,index)=>{
    if(token==='Tf'&&tokens[index-2]?.startsWith('/')){const size=numbers(index,1)?.[0];if(size!==undefined&&size>=0)style.fontSize=size;}
    const count=token==='g'?1:token==='rg'?3:token==='k'?4:0;if(!count)return;
    const values=numbers(index,count);if(!values||values.some(value=>value<0||value>1))return;
    style.color=count===1?grayscale(values[0]!):count===3?rgb(values[0]!,values[1]!,values[2]!):cmyk(values[0]!,values[1]!,values[2]!,values[3]!);
  });return style;
}

export function choiceListAppearance(field:PDFOptionList,widget:PDFWidgetAnnotation,font:PDFFont,choices:readonly {label:string;value:string}[]):PDFOperator[]{
  const local=defaultStyle(widget),inherited=defaultStyle(field.acroField),textColor=local.color??inherited.color??rgb(0,0,0);
  const rectangle=widget.getRectangle(),appearance=widget.getAppearanceCharacteristics(),borderWidth=widget.getBorderStyle()?.getWidth()??0,rotation=reduceRotation(appearance?.getRotation());
  const {width,height}=adjustDimsForRotation(rectangle,rotation),padding=1,bounds={x:borderWidth+padding,y:borderWidth+padding,width:width-2*(borderWidth+padding),height:height-2*(borderWidth+padding)};
  const ordered=[...choices];if(field.isSorted())ordered.sort((a,b)=>a.label<b.label?-1:a.label>b.label?1:0);
  const {fontSize,lineHeight}=layoutMultilineText(ordered.map(choice=>choice.label).join('\n'),{alignment:TextAlignment.Left,fontSize:local.fontSize??inherited.fontSize,font,bounds});
  const selected=new Set(field.getSelected()),lines:TextPosition[]=[],selectedLines:number[]=[];
  for(const choice of ordered){
    const part=layoutMultilineText(choice.label,{alignment:TextAlignment.Left,fontSize,font,bounds}),offset=lines.length*lineHeight;
    for(const line of part.lines){if(selected.has(choice.value))selectedLines.push(lines.length);lines.push({...line,y:line.y-offset});}
  }
  const target=local.color||local.fontSize!==undefined?widget:field.acroField;
  target.setDefaultAppearance(setFillingColor(textColor).toString()+'\n'+setFontAndSize(font.name,fontSize).toString());
  return [...rotateInPlace({...rectangle,rotation}),...drawOptionList({
    x:borderWidth/2,y:borderWidth/2,width:width-borderWidth,height:height-borderWidth,borderWidth,
    color:componentsToColor(appearance?.getBackgroundColor()),borderColor:componentsToColor(appearance?.getBorderColor()),
    textLines:lines,textColor,font:font.name,fontSize,lineHeight,selectedLines,selectedColor:rgb(153/255,193/255,218/255),padding,
  })];
}
