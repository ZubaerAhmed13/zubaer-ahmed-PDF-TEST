import {describe,expect,it} from 'vitest';
import {outputFilename} from '../src/app/outputFilename';

describe('safe output download names',()=>{
  it('keeps the exact tool-defined extension without duplication',()=>{
    expect(outputFilename('Archive.PDF','original.pdf')).toBe('Archive.pdf');
    expect(outputFilename('Report','original.pdf')).toBe('Report.pdf');
    expect(outputFilename('   ...  ','original.pdf')).toBe('document.pdf');
    expect(outputFilename('draft. .pdf','original.pdf')).toBe('draft.pdf');
  });
  it('prevents path delimiters and platform-invalid characters',()=>{
    expect(outputFilename('../Reviewed/Copy.PDF','original.pdf')).toBe('-Reviewed-Copy.pdf');
    expect(outputFilename('one:two?three*four','original.pdf')).toBe('one-two-three-four.pdf');
    expect(outputFilename('CON','original.pdf')).toBe('_CON.pdf');
    expect(outputFilename('lpt9.notes','original.pdf')).toBe('_lpt9.notes.pdf');
    expect(outputFilename('ordinary.notes','original.pdf')).toBe('ordinary.notes.pdf');
  });
  it('disarms direction overrides, isolates and invisible separators',()=>{
    const result=outputFilename('report\u202efdp\u202c\u2066\u2069\u061c\u200b','original.pdf');
    expect(result).toBe('report-fdp-----.pdf');
    expect(result).not.toMatch(/[\u061c\u200b\u202a-\u202e\u2066-\u2069]/u);
    expect(outputFilename('line\u2028break\u0080','original.pdf')).toBe('line-break-.pdf');
  });
  it('preserves genuine multilingual text and never splits an emoji surrogate pair',()=>{
    expect(outputFilename('  Résumé বাংলা  ','source.pdf')).toBe('Résumé বাংলা.pdf');
    expect(outputFilename('😀'.repeat(105),'source.pdf')).toBe('😀'.repeat(100)+'.pdf');
    expect(outputFilename('A\u0301','source.pdf')).toBe('Á.pdf');
    expect(outputFilename('نام\u200cها','source.pdf')).toBe('نام\u200cها.pdf');
  });
});
