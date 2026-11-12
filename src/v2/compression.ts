import type {OperationResult} from '../pdf/types';

export const compressionPresets:Record<string,{imageQuality:number;maxImageDimension:number}>={
  balanced:{imageQuality:.79,maxImageDimension:2200},quality:{imageQuality:.91,maxImageDimension:3500},small:{imageQuality:.61,maxImageDimension:1400}
};
export function compressionSettings(options:Record<string,unknown>):{imageQuality:number;maxImageDimension:number}{
  const preset=compressionPresets[String(options.compressionPreset??'balanced')]??compressionPresets.balanced!;
  const quality=options.jpegQuality===undefined?preset.imageQuality*100:Number(options.jpegQuality);
  const pixels=options.maxImagePixels===undefined?preset.maxImageDimension:Number(options.maxImagePixels);
  return{imageQuality:Math.max(.5,Math.min(.95,Number.isFinite(quality)?quality/100:preset.imageQuality)),maxImageDimension:Math.max(900,Math.min(5000,Math.round(Number.isFinite(pixels)?pixels:preset.maxImageDimension)))};
}
export function compressionSummary(info:OperationResult['info']){
  const input=Number(info?.inputBytes??info?.originalBytes??0),output=Number(info?.outputBytes??0);
  const savedBytes=Math.max(0,input-output);
  return{input,output,savedBytes,percent:input?Math.round(savedBytes/input*100):0,eligible:Number(info?.eligibleImages??0),recompressed:Number(info?.recompressedImages??0),grew:output>input};
}
