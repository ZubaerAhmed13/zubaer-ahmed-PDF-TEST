import {inflateSync} from 'node:zlib';
import {readFile,mkdir,writeFile,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

/** Reconstruct WOFF1's original sfnt tables; no font conversion dependency. */
export function woffToSfnt(input) {
  const data=Buffer.from(input);
  if(data.length<44||data.readUInt32BE(0)!==0x774f4646||data.readUInt32BE(4)!==0x10000)throw new Error('Expected a TrueType WOFF1 font.');
  const count=data.readUInt16BE(12),size=data.readUInt32BE(16);
  if(data.readUInt32BE(8)!==data.length||!count||count>100||size>8*1024*1024||size<12+count*16||data.length<44+count*20)throw new Error('Invalid font size or directory budget.');
  const output=Buffer.alloc(size),power=2**Math.floor(Math.log2(count));
  output.writeUInt32BE(0x10000);output.writeUInt16BE(count,4);output.writeUInt16BE(power*16,6);output.writeUInt16BE(Math.log2(power),8);output.writeUInt16BE(count*16-power*16,10);
  let offset=12+count*16,head=-1;
  const tags=new Set();
  for(let i=0;i<count;i++){
    const entry=44+i*20,tag=data.toString('ascii',entry,entry+4),start=data.readUInt32BE(entry+4),compressed=data.readUInt32BE(entry+8),length=data.readUInt32BE(entry+12);
    if(tags.has(tag)||!length||compressed>length||start<44+count*20||start+compressed>data.length||offset+Math.ceil(length/4)*4>size)throw new Error('Invalid WOFF table directory.');
    tags.add(tag);
    const table=compressed===length?data.subarray(start,start+length):inflateSync(data.subarray(start,start+compressed),{maxOutputLength:length});
    if(table.length!==length)throw new Error('Invalid WOFF table size.');
    table.copy(output,offset);
    const target=12+i*16;data.copy(output,target,entry,entry+4);output.writeUInt32BE(data.readUInt32BE(entry+16),target+4);output.writeUInt32BE(offset,target+8);output.writeUInt32BE(length,target+12);
    if(tag==='head'){if(length<12)throw new Error('Invalid font head table.');head=offset;output.writeUInt32BE(0,head+8);}
    offset+=Math.ceil(length/4)*4;
  }
  if(offset!==size||head<0||size%4)throw new Error('Invalid sfnt font size or head table.');
  let checksum=0;for(let i=0;i<size;i+=4)checksum=(checksum+output.readUInt32BE(i))>>>0;
  output.writeUInt32BE((0xb1b0afba-checksum)>>>0,head+8);
  return output;
}
async function stage(){
  const root=fileURLToPath(new URL('../',import.meta.url)),fontDir=path.join(root,'public/native-fonts'),licenseDir=path.join(root,'public/licenses');
  await mkdir(fontDir,{recursive:true});await mkdir(licenseDir,{recursive:true});
  await writeFile(path.join(fontDir,'DocFlowSourceSans.ttf'),woffToSfnt(await readFile(path.join(root,'public/fonts/DocFlowSans.woff'))));
  await copyFile(path.join(root,'node_modules/@embedpdf/pdfium/LICENSE'),path.join(licenseDir,'embedpdf-MIT.txt'));
  await copyFile(path.join(root,'node_modules/@embedpdf/pdfium/LICENSE.pdfium'),path.join(licenseDir,'pdfium-third-party.txt'));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await stage();
