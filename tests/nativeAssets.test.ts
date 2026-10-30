import {describe,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import {woffToSfnt} from '../scripts/stage-native-assets.mjs';
import {encodedImageDimensions} from '../src/pdf/nativeModel';

describe('deterministic licensed native font',()=>{
  it('reconstructs a valid sfnt with the same glyph repertoire and checksum',async()=>{
    const source=await readFile('public/fonts/DocFlowSans.woff'),out=woffToSfnt(source);
    expect(out).toEqual(woffToSfnt(source));expect(out.readUInt32BE()).toBe(0x10000);
    const font=fontkit.create(out),original=fontkit.create(source);
    expect(font.characterSet).toEqual(original.characterSet);
    let sum=0;for(let i=0;i<out.length;i+=4)sum=(sum+out.readUInt32BE(i))>>>0;
    expect(sum).toBe(0xb1b0afba);
  });
  it('rejects corrupt font directories and expansion bombs',()=>{
    expect(()=>woffToSfnt(Buffer.alloc(100))).toThrow(/WOFF/);
    const bogus=Buffer.alloc(64);bogus.writeUInt32BE(0x774f4646);bogus.writeUInt32BE(0x10000,4);bogus.writeUInt32BE(64,8);bogus.writeUInt16BE(1,12);bogus.writeUInt32BE(100_000_000,16);
    expect(()=>woffToSfnt(bogus)).toThrow(/budget|size|directory/i);
  });
  it('rejects excessive image dimensions before any image decoder runs',()=>{
    const png=Buffer.from('89504e470d0a1a0a0000000d494844520000002000000020080600000000000000','hex');
    expect(encodedImageDimensions(png)).toEqual({width:32,height:32});
    png.writeUInt32BE(50000,16);expect(()=>encodedImageDimensions(png)).toThrow(/pixel|8,192/);
    expect(()=>encodedImageDimensions(new Uint8Array([255,216,255,192,0,17,8,255]))).toThrow(/image|JPEG/);
  });
});
