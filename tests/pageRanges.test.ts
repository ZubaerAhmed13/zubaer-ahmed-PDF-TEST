import { describe, expect, it } from 'vitest';
import { parsePageOrder, parsePageSelection, parseSplitRanges } from '../src/pdf/pageRanges';

describe('page range parsing', () => {
  it('parses sorted unique selections', () => {
    expect(parsePageSelection('1,3,5-7,3', 10)).toEqual([0,2,4,5,6]);
  });
  it('uses all pages for blank selection', () => {
    expect(parsePageSelection('', 3)).toEqual([0,1,2]);
  });
  it('rejects out of bounds pages', () => {
    expect(() => parsePageSelection('4', 3)).toThrow(/Invalid page/);
  });
  it('preserves duplicates in explicit page order', () => {
    expect(parsePageOrder('1,2,2,3', 3)).toEqual([0,1,1,2]);
  });
  it('supports semicolon-delimited split groups', () => {
    expect(parseSplitRanges('1-2;3,5', 5)).toEqual([[0,1],[2,4]]);
  });
});
