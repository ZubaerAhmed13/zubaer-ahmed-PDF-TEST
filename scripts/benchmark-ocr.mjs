import { createWorker } from 'tesseract.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const rows = JSON.parse(await readFile('tests/fixtures/ocr-corpus/corpus.json', 'utf8'));
const normal = s => s.normalize('NFC').replace(/\s+/gu, ' ').trim();
function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const row = [i]; for (let j = 1; j <= b.length; j++) row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = row; }
  return prev[b.length];
}
const results = [];
for (const language of ['eng', 'deu', 'eng+deu']) {
  const worker = await createWorker(language.split('+'), 1, { langPath: resolve('public/ocr/lang'), corePath: resolve('node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js'), gzip: false, cacheMethod: 'none' });
  try { for (const row of rows.filter(r => r.language === language)) {
    const bytes = await readFile('tests/fixtures/ocr-corpus/' + row.file), start = performance.now();
    const { data } = await worker.recognize(bytes), expected = normal(row.reference), actual = normal(data.text), edits = distance([...expected], [...actual]);
    results.push({ ...row, reference: undefined, sha256: createHash('sha256').update(bytes).digest('hex'), characters: [...expected].length, edits, cerPercent: Number((100 * edits / [...expected].length).toFixed(3)), elapsedMs: Math.round(performance.now() - start), actual });
  } } finally { await worker.terminate(); }
}
const aggregate = Object.fromEntries(['clean', 'difficult', 'mixed'].map(category => { const selected = results.filter(r => r.category === category), characters = selected.reduce((n, r) => n + r.characters, 0), edits = selected.reduce((n, r) => n + r.edits, 0); return [category, { images: selected.length, characters, edits, cerPercent: Number((100 * edits / characters).toFixed(3)) }]; }));
await mkdir('artifacts/r4', { recursive: true });
await writeFile('artifacts/r4/ocr-benchmark.json', JSON.stringify({ engine: 'Tesseract.js 7.0.0, packaged LSTM models; original pixels without cleanup', normalization: 'NFC, whitespace collapsed, case and punctuation retained; Unicode code-point Levenshtein / reference characters', aggregate, results }, null, 2) + '\n');
console.log(JSON.stringify(aggregate, null, 2));
if (aggregate.clean.cerPercent > 2) throw Error('Fixed clean corpus exceeds the 2% CER release target.');
