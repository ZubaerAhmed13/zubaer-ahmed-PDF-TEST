import type { ComparisonResult } from '../pdf/pdfComparison';

/** Both document panes always navigate to the same matched pair. */
export function mountComparisonReview(host: HTMLElement, summary: ComparisonResult, urls: string[]): void {
  host.replaceChildren();
  const heading = document.createElement('p'); heading.className = 'docflow-diff-headline';
  heading.textContent = `${summary.changedPages} changed page match(es) of ${summary.pagesCompared} compared · A: ${summary.leftPages} pages · B: ${summary.rightPages} pages`;
  host.append(heading);
  const warning = document.createElement('p'); warning.className = 'warning-text';
  warning.textContent = (summary.limited ? 'Incomplete comparison: pages beyond the limit were not matched. ' : '') + 'Matches are heuristic. Review uncertain, duplicate or empty pages manually. Small changes can be missed by downscaled rendering.';
  host.append(warning);
  const navigation = document.createElement('div'); navigation.className = 'workspace-actions';
  const previous = document.createElement('button'), next = document.createElement('button'), select = document.createElement('select'), label = document.createElement('label');
  previous.type = next.type = 'button'; previous.className = next.className = 'secondary'; previous.textContent = 'Previous change'; next.textContent = 'Next change'; label.textContent = 'Matched pages'; select.setAttribute('aria-label', 'Matched pages');
  summary.rows.forEach((row, i) => { const option = document.createElement('option'); option.value = String(i); option.textContent = `A ${row.leftPage ?? '—'} ↔ B ${row.rightPage ?? '—'}: ${row.status}${row.moved ? ' · moved' : ''}${row.uncertain ? ' · uncertain' : ''}`; select.append(option); });
  label.append(select); navigation.append(previous, label, next); host.append(navigation);
  const detail = document.createElement('section'); detail.setAttribute('aria-label', 'Selected page match'); detail.setAttribute('aria-live', 'polite'); host.append(detail);
  let index = Math.max(0, summary.rows.findIndex(r => r.status !== 'same' || r.moved));
  let activeUrls: string[] = [];
  const changed = summary.rows.flatMap((r, i) => r.status !== 'same' || r.moved ? [i] : []);
  const render = (): void => {
    for (const url of activeUrls) { URL.revokeObjectURL(url); const i = urls.indexOf(url); if (i >= 0) urls.splice(i, 1); } activeUrls = [];
    detail.replaceChildren(); select.value = String(index);
    const row = summary.rows[index]; if (!row) return;
    previous.disabled = !changed.some(i => i < index); next.disabled = !changed.some(i => i > index);
    const title = document.createElement('h3'); title.textContent = `A page ${row.leftPage ?? 'absent'} ↔ B page ${row.rightPage ?? 'absent'} · ${row.status}${row.moved ? ' · moved' : ''}${row.uncertain ? ' · uncertain match' : ''}`; detail.append(title);
    const explanation = document.createElement('p'); explanation.textContent = `${row.textChanged ? 'text changed' : 'No selectable text change in this mode'}${row.pixelDifferencePercent === null ? '' : ` · pixels changed: ${row.pixelDifferencePercent}%`}`; detail.append(explanation);
    const data = summary.previews[index];
    if (data) {
      const figure = document.createElement('figure'); figure.className = 'docflow-diff-preview';
      const sides = document.createElement('div'); sides.className = 'docflow-diff-side-by-side';
      const left = document.createElement('img'), right = document.createElement('img'), mask = document.createElement('img');
      left.alt = `Document A page ${row.leftPage ?? 'absent'}`; right.alt = `Document B page ${row.rightPage ?? 'absent'}`; mask.alt = 'Differences highlighted in red';
      for (const [img, blob] of [[left, data.left], [right, data.right], [mask, data.overlay]] as const) { img.src = URL.createObjectURL(blob); urls.push(img.src); activeUrls.push(img.src); }
      sides.append(left, right); const overlay = document.createElement('div'); overlay.className = 'docflow-diff-overlay'; const background = left.cloneNode() as HTMLImageElement; background.alt = ''; background.setAttribute('aria-hidden', 'true'); overlay.append(background, mask);
      const sliderLabel = document.createElement('label'); sliderLabel.textContent = 'Difference overlay opacity'; const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.value = '85'; slider.setAttribute('aria-label', 'Difference overlay opacity'); mask.style.opacity = '.85'; slider.addEventListener('input', () => { mask.style.opacity = String(Number(slider.value) / 100); }); sliderLabel.append(slider); figure.append(sides, overlay, sliderLabel); detail.append(figure);
    }
    const text = document.createElement('p'); text.className = 'comparison-word-changes';
    for (const change of row.changes) { const span = document.createElement(change.kind === 'added' ? 'ins' : change.kind === 'removed' ? 'del' : 'span'); span.textContent = change.text + ' '; text.append(span); }
    detail.append(text);
    if (row.textLimited) detail.append(document.createTextNode('Incomplete word diff: first 600 words from each page.'));
  };
  select.addEventListener('change', () => { index = Number(select.value); render(); });
  previous.addEventListener('click', () => { index = changed.filter(i => i < index).at(-1) ?? index; render(); });
  next.addEventListener('click', () => { index = changed.find(i => i > index) ?? index; render(); });
  const all = document.createElement('div'); all.className = 'docflow-diff-pages';
  summary.rows.forEach((row, i) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = `Page ${row.page}: ${row.status} · A ${row.leftPage ?? '—'} ↔ B ${row.rightPage ?? '—'}${row.moved ? ' · moved' : ''}${row.uncertain ? ' · uncertain' : ''}`; button.addEventListener('click', () => { index = i; render(); select.focus(); }); all.append(button); });
  host.append(all); render();
}
