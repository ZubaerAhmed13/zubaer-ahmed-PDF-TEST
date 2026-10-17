export interface PageSignature { text: string; fingerprint?: readonly number[] }
export interface PageMatch { left: number | null; right: number | null; confidence: number; uncertain: boolean; moved: boolean }
const normal = (s: string): string => s.normalize('NFKC').replace(/\s+/gu, ' ').trim();
function similarity(a: PageSignature, b: PageSignature): number {
  const x = normal(a.text), y = normal(b.text);
  if (x && x === y) return 1;
  if (x && y) {
    const words = (s: string): Set<string> => new Set(s.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
    const l = words(x), r = words(y);
    return 2 * [...l].filter(w => r.has(w)).length / Math.max(1, l.size + r.size);
  }
  if (!x && !y && a.fingerprint?.length && a.fingerprint.length === b.fingerprint?.length) {
    const delta = a.fingerprint.reduce((sum, v, i) => sum + Math.abs(v - b.fingerprint![i]!), 0) / a.fingerprint.length;
    // Dark content is required: blank sheets have no reliable identity.
    if (a.fingerprint.some(v => v < 220) && delta < 5) return 1 - delta / 255;
  }
  return 0;
}
/** Exact matches first, then mutual best text candidates. Ambiguity is never hidden. */
export function alignPages(left: PageSignature[], right: PageSignature[]): PageMatch[] {
  const usedL = new Set<number>(), usedR = new Set<number>(), pairs: PageMatch[] = [];
  const candidates: { l: number; r: number; score: number }[] = [];
  left.forEach((a, l) => right.forEach((b, r) => { const score = similarity(a, b); if (score >= .3) candidates.push({ l, r, score }); }));
  candidates.sort((a, b) => b.score - a.score || Math.abs(a.l - a.r) - Math.abs(b.l - b.r));
  for (const c of candidates) {
    if (usedL.has(c.l) || usedR.has(c.r)) continue;
    const alternatives = candidates.filter(v => v !== c && !usedL.has(v.l) && !usedR.has(v.r) && (v.l === c.l || v.r === c.r));
    const ambiguous = alternatives.some(v => v.score >= c.score - .08);
    if (c.score < .98 && ambiguous) continue;
    usedL.add(c.l); usedR.add(c.r); pairs.push({ left: c.l + 1, right: c.r + 1, confidence: c.score, uncertain: ambiguous || c.score < .6, moved: false });
  }
  // Unmatched pages in equal-sized gaps may be heavily revised; retain reviewable pairs.
  const remainingL = left.map((_, i) => i).filter(i => !usedL.has(i)), remainingR = right.map((_, i) => i).filter(i => !usedR.has(i));
  if (remainingL.length === remainingR.length) {
    remainingL.forEach((l, i) => { const r = remainingR[i]!; usedL.add(l); usedR.add(r); pairs.push({ left: l + 1, right: r + 1, confidence: 0, uncertain: true, moved: false }); });
  }
  // Longest increasing sequence distinguishes true moves from insertion offsets.
  const ordered = pairs.slice().sort((a, b) => a.right! - b.right!);
  const lengths = ordered.map(() => 1), previous = ordered.map(() => -1);
  for (let i = 0; i < ordered.length; i++) for (let j = 0; j < i; j++) if (ordered[j]!.left! < ordered[i]!.left! && lengths[j]! + 1 > lengths[i]!) { lengths[i] = lengths[j]! + 1; previous[i] = j; }
  const stable = new Set<number>(); let index = lengths.indexOf(Math.max(...lengths));
  while (index >= 0) { stable.add(index); index = previous[index]!; }
  ordered.forEach((pair, i) => { pair.moved = !stable.has(i); });
  for (let i = 0; i < left.length; i++) if (!usedL.has(i)) ordered.push({ left: i + 1, right: null, confidence: 1, uncertain: false, moved: false });
  for (let i = 0; i < right.length; i++) if (!usedR.has(i)) ordered.push({ left: null, right: i + 1, confidence: 1, uncertain: false, moved: false });
  return ordered.sort((a, b) => (a.right ?? (a.left! + .5)) - (b.right ?? (b.left! + .5)));
}
export interface TextChange { kind: 'same' | 'added' | 'removed'; text: string }
/** Bounded word LCS. Reports its truncation rather than allocating unbounded matrices. */
export function wordChanges(a: string, b: string): { changes: TextChange[]; truncated: boolean } {
  const l = normal(a).split(' ').filter(Boolean), r = normal(b).split(' ').filter(Boolean), limit = 600;
  const truncated = l.length > limit || r.length > limit; l.length = Math.min(l.length, limit); r.length = Math.min(r.length, limit);
  const matrix = Array.from({ length: l.length + 1 }, () => new Uint16Array(r.length + 1));
  for (let i = l.length - 1; i >= 0; i--) for (let j = r.length - 1; j >= 0; j--) matrix[i]![j] = l[i] === r[j] ? matrix[i + 1]![j + 1]! + 1 : Math.max(matrix[i + 1]![j]!, matrix[i]![j + 1]!);
  const changes: TextChange[] = []; let i = 0, j = 0;
  const add = (kind: TextChange['kind'], text: string): void => { const last = changes.at(-1); if (last?.kind === kind) last.text += ' ' + text; else changes.push({ kind, text }); };
  while (i < l.length || j < r.length) {
    if (i < l.length && j < r.length && l[i] === r[j]) { add('same', l[i++]!); j++; }
    else if (j < r.length && (i === l.length || matrix[i]![j + 1]! >= matrix[i + 1]![j]!)) add('added', r[j++]!);
    else add('removed', l[i++]!);
  }
  return { changes, truncated };
}
