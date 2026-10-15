import { describe, expect, it } from 'vitest';
import { normalizeInspectedFields } from '../src/app/visualFormEditor';

describe('visual AcroForm field validation', () => {
  it('preserves options and multi-selection without treating values as markup', () => {
    expect(normalizeInspectedFields([
      { name: '<img onerror=alert(1)>', type: 'text', value: '<script>hello</script>', choices: [] },
      { name: 'Skills', type: 'option-list', value: 'PMO', choices: ['Finance', 'PMO'], selected: ['PMO'] }
    ])).toEqual([
      { name: '<img onerror=alert(1)>', type: 'text', value: '<script>hello</script>', choices: [], selected: undefined, multiline: false },
      { name: 'Skills', type: 'option-list', value: 'PMO', choices: ['Finance', 'PMO'], selected: ['PMO'], multiline: false }
    ]);
  });
  it('rejects duplicated, missing and malformed inspection records', () => {
    expect(() => normalizeInspectedFields(null)).toThrow();
    expect(() => normalizeInspectedFields([{name: 'A'}, {name: 'A'}])).toThrow();
    expect(() => normalizeInspectedFields([{name: 1, type: 'text'}])).toThrow();
  });
});
