import {describe,it,expect} from 'vitest';
import {compressionSettings,compressionSummary} from '../src/v2/compression';

describe('quality-aware compression',()=>{
  it('maps explicit image quality and pixel limits to actual worker options',()=>{
    expect(compressionSettings({compressionPreset:'custom',jpegQuality:65,maxImagePixels:1400})).toEqual({imageQuality:.65,maxImageDimension:1400});
    expect(compressionSettings({compressionPreset:'quality'})).toEqual({imageQuality:.91,maxImageDimension:3500});
  });
  it('bounds invalid controls without inventing DPI or compression savings',()=>{
    expect(compressionSettings({jpegQuality:200,maxImagePixels:0})).toEqual({imageQuality:.95,maxImageDimension:900});
    expect(compressionSummary({inputBytes:1000,outputBytes:1000,eligibleImages:0,recompressedImages:0})).toMatchObject({savedBytes:0,percent:0,recompressed:0});
    expect(compressionSummary({inputBytes:1000,outputBytes:600,eligibleImages:2,recompressedImages:1})).toMatchObject({savedBytes:400,percent:40,recompressed:1});
  });
});
