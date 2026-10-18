import { describe, it, expect } from 'vitest';
import {
  rectangleFromDrag, validateRedactions, chooseRasterScale,
  REDACTION_MAX_PAGES, REDACTION_MAX_BYTES
} from '../src/pdf/secureRasterRedaction';

describe('permanent raster redaction input security', () => {
  it('normalises reverse-direction drags in rotated PDF.js viewport coordinates', () => {
    expect(rectangleFromDrag(2, .8, .6, .1, .25)).toMatchObject({ page: 2, x: .1, y: .25 });
    expect(rectangleFromDrag(2, .8, .6, .1, .25).width).toBeCloseTo(.7, 12);
    expect(rectangleFromDrag(2, .8, .6, .1, .25).height).toBeCloseTo(.35, 12);
    expect(rectangleFromDrag(1, -5, 2, .5, .2)).toEqual({ page: 1, x: 0, y: .2, width: .5, height: .8 });
  });
  it('refuses empty, off-page, tiny, nonfinite and overlong mask lists', () => {
    expect(() => validateRedactions([], 2)).toThrow();
    expect(() => validateRedactions([{page:3,x:0,y:0,width:1,height:1}],2)).toThrow();
    expect(() => validateRedactions([{page:1,x:.9,y:.2,width:.5,height:.1}],2)).toThrow();
    expect(() => validateRedactions([{page:1,x:NaN,y:0,width:.3,height:.3}],2)).toThrow();
    expect(() => validateRedactions([{page:1,x:0,y:0,width:.001,height:.3}],2)).toThrow();
    expect(() => validateRedactions(Array.from({length:121}, () => ({page:1,x:0,y:0,width:1,height:1})),2)).toThrow();
  });
  it('accepts distinct-page masks and bounds high resolution image buffers', () => {
    expect(validateRedactions([{page:1,x:.2,y:.3,width:.1,height:.2},{page:2,x:0,y:0,width:1,height:1}],2)).toHaveLength(2);
    const scale = chooseRasterScale(4000, 9000);
    expect(scale * 9000).toBeLessThanOrEqual(2200);
    expect(scale * 4000 * scale * 9000).toBeLessThanOrEqual(3200000);
    expect(REDACTION_MAX_PAGES).toBe(15);
    expect(REDACTION_MAX_BYTES).toBe(40 * 1024 * 1024);
  });
});

describe('R5 requested redaction resolution', () => {
  it('uses requested DPI while preserving hard pixel/dimension caps', () => {
    expect(chooseRasterScale(612,792,72)).toBe(1);
    expect(chooseRasterScale(612,792,144)).toBe(2);
    expect(chooseRasterScale(612,792,300)).toBeLessThanOrEqual(2200/792);
    expect(() => chooseRasterScale(612,792,NaN)).toThrow(/resolution/i);
    expect(() => chooseRasterScale(612,792,10)).toThrow(/resolution/i);
  });
});
