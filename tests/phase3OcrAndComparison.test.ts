import { describe, expect, it } from 'vitest';
import { normalizedComparisonText, classifyPagePair, pixelDifference } from '../src/pdf/pdfComparison';
import { parseOcrTsv } from '../src/pdf/localOcr';

describe('local OCR and PDF comparison primitives', () => {
  it('extracts confidence-filtered word boxes from Tesseract TSV safely', () => {
    const tsv = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n' +
      '5\t1\t1\t1\t1\t1\t12\t34\t120\t28\t92.2\tDocFlow\n' +
      '5\t1\t1\t1\t1\t2\t130\t34\t60\t28\t12.5\tgarbage\n';
    expect(parseOcrTsv(tsv)).toEqual([{ text: 'DocFlow', x: 12, y: 34, w: 120, h: 28, confidence: 92.2 }]);
    expect(parseOcrTsv('bad input')).toEqual([]);
  });
  it('normalises whitespace and classifies inserted or removed pages', () => {
    expect(normalizedComparisonText('DocFlow  \n file')).toBe('DocFlow file');
    expect(classifyPagePair('Hello  world', 'Hello world')).toMatchObject({ status: 'same', textChanged: false });
    expect(classifyPagePair('Original', 'Revised')).toMatchObject({ status: 'different', textChanged: true });
    expect(classifyPagePair(null, '')).toMatchObject({ status: 'missing-left', textChanged: true });
    expect(classifyPagePair('', null)).toMatchObject({ status: 'missing-right', textChanged: true });
  });
  it('detects marked pixel changes and produces a red overlay without content leakage', () => {
    const l = new Uint8ClampedArray([255,255,255,255, 10,10,10,255]);
    const r = new Uint8ClampedArray([255,255,255,255, 200,10,10,255]);
    const difference = pixelDifference(l,r);
    expect(difference.percent).toBe(50);
    expect([...difference.mask.slice(4,8)]).toEqual([224,57,47,255]);
    expect(() => pixelDifference(l, new Uint8ClampedArray(4))).toThrow();
  });
});
