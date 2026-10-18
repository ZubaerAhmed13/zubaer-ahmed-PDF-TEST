import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountVisualFormEditor, normalizeInspectedFields } from '../src/app/visualFormEditor';

class ElementStub {
  value = ''; textContent = ''; className = ''; type = ''; writes = 0;
  append(): void {} replaceChildren(): void {} setAttribute(): void {}
  addEventListener(): void {} removeEventListener(): void {} dispatchEvent(): boolean { this.writes++; return true; }
}
afterEach(() => vi.unstubAllGlobals());

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
  it('never writes defaults into an active advanced editor when delayed inspection mounts', () => {
    const advanced = new ElementStub(); advanced.value = '{}';
    vi.stubGlobal('document', { activeElement: advanced, createElement: () => new ElementStub() });
    mountVisualFormEditor(new ElementStub() as unknown as HTMLElement, advanced as unknown as HTMLTextAreaElement, []);
    expect(advanced.writes).toBe(0);
  });
  it('preserves advanced JSON already entered before inspection completes', () => {
    const advanced = new ElementStub(); advanced.value = '{"CustomerName":"My entered value"}';
    vi.stubGlobal('document', { activeElement: null, createElement: () => new ElementStub() });
    mountVisualFormEditor(new ElementStub() as unknown as HTMLElement, advanced as unknown as HTMLTextAreaElement, []);
    expect(advanced.value).toBe('{"CustomerName":"My entered value"}');
  });
});
