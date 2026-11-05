import {NOTICE_VERSION,parseCreateJobRequest} from '../../backend/contracts';
import type {RemoteSettings} from './remoteProcessing';
export type ServerOperation=RemoteSettings['operation'];
const officeTypes:Record<string,string>={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
const validationBase={idempotencyKey:'00000000-0000-4000-8000-000000000001',consent:{accepted:true,noticeVersion:NOTICE_VERSION}};
function validate(file:{name:string;type:string;size:number},settings:RemoteSettings){return parseCreateJobRequest({...validationBase,...settings,files:[{...file,sha256:'0'.repeat(64)}]});}
export function serverSettings(operation:ServerOperation,values:Record<string,unknown>):RemoteSettings{
  let settings:RemoteSettings;
  if(operation==='office-to-pdf')settings={operation,options:{}};
  else if(operation==='compress')settings={operation,options:{jpegQuality:Number(values.serverQuality??85),dpi:Number(values.serverDpi??150),maxImagePixels:Number(values.serverPixels??2200)}};
  else{
    const language=values.language??'eng';if(!['eng','deu','eng+deu'].includes(String(language)))throw Error('Choose English, German or both for OCR.');
    settings={operation,options:{languages:language==='eng+deu'?['eng','deu']:language==='deu'?['deu']:['eng'],deskew:values.serverDeskew===true,rotate:values.serverRotate===true}};
  }
  validate({name:operation==='office-to-pdf'?'input.docx':'input.pdf',type:operation==='office-to-pdf'?officeTypes.docx!:'application/pdf',size:1},settings);
  return settings;
}
/** Metadata screening only. File/Blob wrapping does not read or upload input bytes. */
export function prepareServerInput(file:File,settings:RemoteSettings):File{
  const extension=file.name.split('.').pop()?.toLowerCase()??'',mime=settings.operation==='office-to-pdf'?officeTypes[extension]:extension==='pdf'?'application/pdf':undefined;
  const selected=mime&&(!file.type||file.type==='application/octet-stream')?new File([file],file.name,{type:mime,lastModified:file.lastModified}):file;
  validate({name:selected.name,type:selected.type,size:selected.size},settings);return selected;
}
