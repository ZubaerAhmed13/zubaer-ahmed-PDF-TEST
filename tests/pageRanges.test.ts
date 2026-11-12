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
  it('limits organized output to 1,000 pages, including duplicate page references', () => {
    expect(parsePageOrder(Array(1000).fill('1').join(','), 1)).toHaveLength(1000);
    expect(() => parsePageOrder(Array(1001).fill('1').join(','), 1)).toThrow(/1,000 output pages/i);
    expect(() => parsePageOrder('', 1001)).toThrow(/1,000 output pages/i);
  });
  it('supports semicolon-delimited split groups', () => {
    expect(parseSplitRanges('1-2;3,5', 5)).toEqual([[0,1],[2,4]]);
    expect(parseSplitRanges('1-2;3,5\\n6-7'.replace('\\n', '\n'), 7)).toEqual([[0,1],[2,4],[5,6]]);
  });
  it('refuses empty comma entries instead of silently exporting fewer pages', () => {
    for (const input of ['1,,3', ',1', '1,', '2, ,4']) {
      expect(() => parsePageSelection(input, 4), input).toThrow(/missing page between commas/);
      expect(() => parsePageOrder(input, 4), input).toThrow(/missing page between commas/);
    }
  });
  it('accepts only decimal page numbers, not hex, scientific or signed notation', () => {
    for (const input of ['0x10', '1e2', '+2', '2.0', '0b10', 'Infinity']) {
      expect(() => parsePageSelection(input, 200), input).toThrow(/invalid page number/i);
      expect(() => parsePageOrder(input, 200), input).toThrow(/invalid page in order/i);
    }
    expect(parsePageSelection(' 02, 4 - 5 ', 5)).toEqual([1,3,4]);
    expect(parsePageOrder('01,02,01', 2)).toEqual([0,1,0]);
  });
  it('rejects consecutive split separators rather than merging empty groups', () => {
    for (const input of ['1;;3', '1;\\n3', '1; ;3', ';1', '1;']) {
      expect(() => parseSplitRanges(input.replaceAll('\\n', '\n'), 4), input).toThrow(/each split range needs at least one page/i);
    }
  });
});
