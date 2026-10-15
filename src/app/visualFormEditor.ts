/**
 * Typed, accessible AcroForm controls presented beside the live PDF preview.
 * This UI never changes source files. The existing worker remains the sole
 * authority for PDF export, preserving all legacy JSON-based workflows.
 */
export interface InspectedFormField {
  name: string;
  type: string;
  value: string;
  choices?: string[];
  selected?: string[];
  multiline?: boolean;
}

interface VisualFormEditor {
  dispose: () => void;
}

type FormValue = string | boolean | string[];
type FormValues = Record<string, FormValue>;

const MAX_VISUAL_FIELDS = 250;
const MAX_VISUAL_CHOICES = 200;

function initialValue(field: InspectedFormField): FormValue | undefined {
  if (field.type === 'checkbox') return field.value === 'true';
  if (field.type === 'option-list') return [...(field.selected ?? (field.value ? field.value.split(', ') : []))];
  if (field.type === 'radio' || field.type === 'dropdown') return field.value || undefined;
  if (field.type === 'text') return field.value;
  return undefined;
}

export function normalizeInspectedFields(source: unknown): InspectedFormField[] {
  if (!Array.isArray(source)) throw new Error('Form field inspection returned an invalid list.');
  if (source.length > 5000) throw new Error('The PDF has too many form fields to inspect safely.');
  const seen = new Set<string>();
  return source.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid form field.');
    const item = value as Record<string, unknown>;
    if (typeof item.name !== 'string' || !item.name || seen.has(item.name)) throw new Error('Invalid or duplicate form field name.');
    seen.add(item.name);
    const type = typeof item.type === 'string' ? item.type : 'unknown';
    const choices = Array.isArray(item.choices)
      ? item.choices.filter((v): v is string => typeof v === 'string').slice(0, MAX_VISUAL_CHOICES + 1)
      : [];
    const selected = Array.isArray(item.selected) ? item.selected.filter((v): v is string => typeof v === 'string') : undefined;
    return {
      name: item.name, type,
      value: typeof item.value === 'string' ? item.value : '',
      choices, selected, multiline: item.multiline === true
    };
  });
}

export function mountVisualFormEditor(
  host: HTMLElement,
  advanced: HTMLTextAreaElement,
  rawFields: unknown
): VisualFormEditor {
  const fields = normalizeInspectedFields(rawFields);
  host.replaceChildren();

  const title = document.createElement('div');
  title.className = 'visual-form-head';
  const heading = document.createElement('h3');
  heading.textContent = 'Fill form fields';
  const count = document.createElement('span');
  count.className = 'visual-form-count';
  count.textContent = fields.length + ' fields';
  title.append(heading, count);

  const help = document.createElement('p');
  help.className = 'visual-form-description';
  help.textContent = 'Edit the fields below while checking the PDF preview. Your source document is unchanged until you export.';

  const notices = document.createElement('p');
  notices.className = 'visual-form-alert';
  notices.setAttribute('role', 'status');
  notices.setAttribute('aria-live', 'polite');

  const actions = document.createElement('div');
  actions.className = 'visual-form-controls';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'secondary';
  reset.textContent = 'Reset to original';
  const focus = document.createElement('button');
  focus.type = 'button';
  focus.className = 'secondary';
  focus.textContent = 'First field';
  actions.append(focus, reset);

  const list = document.createElement('div');
  list.className = 'visual-form-field-list';
  list.setAttribute('aria-label', 'Editable PDF form fields');
  const controls = new Map<string, HTMLElement>();
  const originals: FormValues = Object.create(null) as FormValues;
  for (const field of fields) {
    const original = initialValue(field);
    if (original !== undefined) originals[field.name] = original;
  }

  const sourceValues = (): FormValues | null => {
    try {
      const value: unknown = JSON.parse(advanced.value || '{}');
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Form values must be a JSON object.');
      return value as FormValues;
    } catch {
      return null;
    }
  };
  const writeValues = (values: FormValues): void => {
    advanced.value = JSON.stringify(values, null, 2);
    advanced.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const updateOne = (field: InspectedFormField, value: FormValue | undefined): void => {
    const values = sourceValues() ?? { ...originals };
    if (value === undefined) delete values[field.name];
    else Object.defineProperty(values, field.name, { value, enumerable: true, configurable: true, writable: true });
    writeValues(values);
    notices.textContent = 'Edits ready. Export to create your filled PDF.';
  };

  const makeControl = (field: InspectedFormField, index: number): HTMLElement | null => {
    const id = 'docflow-form-' + index;
    const choices = field.choices ?? [];
    const original = initialValue(field);
    if (field.type === 'text') {
      const input = field.multiline ? document.createElement('textarea') : document.createElement('input');
      if (input instanceof HTMLInputElement) input.type = 'text';
      else input.rows = 3;
      input.id = id;
      input.value = typeof original === 'string' ? original : '';
      input.autocomplete = 'off';
      input.addEventListener('input', () => updateOne(field, input.value));
      return input;
    }
    if (field.type === 'checkbox') {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = id;
      input.checked = original === true;
      input.addEventListener('change', () => updateOne(field, input.checked));
      return input;
    }
    if (field.type === 'radio') {
      if (!choices.length || choices.length > MAX_VISUAL_CHOICES) return null;
      const group = document.createElement('div');
      group.className = 'visual-form-radio';
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-label', field.name);
      for (const [choiceIndex, choice] of choices.entries()) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'docflow-visual-radio-' + index;
        input.value = choice;
        input.id = id + '-' + choiceIndex;
        input.checked = original === choice;
        input.addEventListener('change', () => { if (input.checked) updateOne(field, choice); });
        label.append(input, document.createTextNode(choice));
        group.append(label);
      }
      return group;
    }
    if (field.type === 'dropdown' || field.type === 'option-list') {
      if (!choices.length || choices.length > MAX_VISUAL_CHOICES) return null;
      const select = document.createElement('select');
      select.id = id;
      const multi = field.type === 'option-list';
      select.multiple = multi;
      if (multi) select.size = Math.min(6, Math.max(3, choices.length));
      else {
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = 'Select an option';
        select.append(empty);
      }
      const active = Array.isArray(original) ? original : [original];
      for (const choice of choices) {
        const option = document.createElement('option');
        option.value = choice;
        option.textContent = choice;
        option.selected = active.includes(choice);
        select.append(option);
      }
      select.addEventListener('change', () => {
        const selected = [...select.selectedOptions].map((item) => item.value);
        updateOne(field, multi ? selected : (selected[0] || undefined));
      });
      return select;
    }
    return null;
  };

  fields.slice(0, MAX_VISUAL_FIELDS).forEach((field, index) => {
    const item = document.createElement('div');
    item.className = 'visual-form-field';
    const label = document.createElement('label');
    label.className = 'visual-form-label';
    label.textContent = field.name;
    const control = makeControl(field, index);
    if (control) {
      if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) {
        label.htmlFor = control.id;
      }
      controls.set(field.name, control);
      const pill = document.createElement('small');
      pill.className = 'visual-form-type';
      pill.textContent = field.type === 'option-list' ? 'Multi-select' : field.type;
      item.append(label, pill, control);
      if (field.type === 'option-list') {
        const hint = document.createElement('small');
        hint.textContent = 'Use Ctrl/Cmd or Shift to select more than one option.';
        item.append(hint);
      }
    } else {
      const unsupported = document.createElement('small');
      unsupported.textContent = 'This field type cannot be edited visually. Use Advanced JSON below.';
      item.append(label, unsupported);
    }
    list.append(item);
  });

  if (fields.length > MAX_VISUAL_FIELDS) {
    const limit = document.createElement('p');
    limit.textContent = 'Showing the first 250 fields. Advanced JSON remains available for additional fields.';
    list.append(limit);
  }

  const onAdvancedInput = (): void => {
    const values = sourceValues();
    if (!values) {
      notices.textContent = 'Advanced JSON is invalid. Correct it before exporting.';
      return;
    }
    notices.textContent = '';
    for (const field of fields) {
      const element = controls.get(field.name);
      if (!element) continue;
      const value = Object.prototype.hasOwnProperty.call(values, field.name) ? values[field.name] : undefined;
      if (element instanceof HTMLInputElement && element.type === 'checkbox') element.checked = value === true;
      else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) element.value = typeof value === 'string' ? value : '';
      else if (element instanceof HTMLSelectElement) {
        if (element.multiple) {
          const active = Array.isArray(value) ? value : [];
          for (const option of element.options) option.selected = active.includes(option.value);
        } else element.value = typeof value === 'string' ? value : '';
      } else if (field.type === 'radio') {
        element.querySelectorAll<HTMLInputElement>('input[type=radio]').forEach((input) => { input.checked = input.value === value; });
      }
    }
  };

  const onReset = (): void => {
    writeValues({ ...originals });
    notices.textContent = 'Restored original field values. The source PDF was not changed.';
  };
  reset.addEventListener('click', onReset);
  focus.addEventListener('click', () => {
    const first = list.querySelector<HTMLElement>('input,select,textarea');
    first?.focus();
  });
  advanced.addEventListener('input', onAdvancedInput);
  host.append(title, help, actions, list, notices);
  writeValues({ ...originals });

  return {
    dispose: () => {
      advanced.removeEventListener('input', onAdvancedInput);
      host.replaceChildren();
    }
  };
}
