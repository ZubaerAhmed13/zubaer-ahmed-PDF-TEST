import { describe, expect, it } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { alignPages, wordChanges } from '../src/pdf/pageAlignment';
import { rotationGeometry, perspectiveMap, applyCleanup, scanOptions } from '../src/pdf/scanProcessing';
import { addOcrWords } from '../src/pdf/localOcr';
import { markdownText } from '../src/pdf/textExtraction';

const sig = (text: string) => ({ text });
describe('R4 document quality', () => {
  it('aligns an inserted cover without cascading changes', () => {
    const rows = alignPages(['Alpha first', 'Beta second', 'Gamma third'].map(sig), ['New cover', 'Alpha first', 'Beta second', 'Gamma third'].map(sig));
    expect(rows.map(r => [r.left, r.right])).toEqual([[null, 1], [1, 2], [2, 3], [3, 4]]);
    expect(rows.some(r => r.moved || r.uncertain)).toBe(false);
  });
  it('classifies deletion and one true moved page separately from offsets', () => {
    const rows = alignPages(['Alpha', 'Beta', 'Gamma', 'Delta'].map(sig), ['Gamma', 'Alpha', 'Delta'].map(sig));
    expect(rows).toContainEqual(expect.objectContaining({ left: 2, right: null }));
    expect(rows.filter(r => r.moved)).toHaveLength(1);
  });
  it('marks duplicate and blank-page identity as uncertain', () => {
    expect(alignPages([sig('same'), sig('same')], [sig('same'), sig('same')]).some(r => r.uncertain)).toBe(true);
    expect(alignPages([sig('')], [sig('')])[0]?.uncertain).toBe(true);
  });
  it('matches distinct scan fingerprints after insertion', () => {
    const a = { text: '', fingerprint: [10, 100, 255] }, b = { text: '', fingerprint: [255, 10, 50] };
    expect(alignPages([a, b], [{ text: 'cover' }, a, b]).map(r => [r.left, r.right])).toEqual([[null, 1], [1, 2], [2, 3]]);
  });
  it('finds word additions/removals and exposes truncation', () => {
    const result = wordChanges('Pay 100 euros today', 'Pay 120 euros tomorrow');
    expect(result.changes.filter(c => c.kind === 'removed').map(c => c.text).join(' ')).toBe('100 today');
    expect(result.changes.filter(c => c.kind === 'added').map(c => c.text).join(' ')).toBe('120 tomorrow');
    expect(wordChanges('a '.repeat(800), 'a').truncated).toBe(true);
  });
  it('inverts quarter-turn and deskew transforms without clipping corners', () => {
    for (const angle of [0, 90, 180, 270, 4.5, -7.2, 94.5]) {
      const g = rotationGeometry(400, 600, angle), c = Math.cos(g.angle), s = Math.sin(g.angle);
      for (const [x, y] of [[0, 0], [400, 600], [55, 120]]) {
        const dx = c * (x! - 200) - s * (y! - 300) + g.width / 2, dy = s * (x! - 200) + c * (y! - 300) + g.height / 2;
        expect(dx).toBeGreaterThanOrEqual(-1e-8); expect(dy).toBeGreaterThanOrEqual(-1e-8);
        expect(g.toSource(dx, dy).x).toBeCloseTo(x!, 8); expect(g.toSource(dx, dy).y).toBeCloseTo(y!, 8);
      }
    }
  });
  it('maps perspective corners and rejects crossed/degenerate crops', () => {
    const corners = [{ x: 30, y: 20 }, { x: 380, y: 60 }, { x: 340, y: 570 }, { x: 50, y: 540 }];
    const map = perspectiveMap(corners);
    [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], i) => { expect(map(u!, v!).x).toBeCloseTo(corners[i]!.x, 8); expect(map(u!, v!).y).toBeCloseTo(corners[i]!.y, 8); });
    expect(() => perspectiveMap([corners[0]!, corners[2]!, corners[1]!, corners[3]!])).toThrow();
    expect(() => scanOptions({ deskew: 16 })).toThrow();
    expect(() => scanOptions({ rotation: 13 })).toThrow();
  });
  it('keeps original colour bytes or applies explicit grayscale/threshold filters', () => {
    const bytes = new Uint8ClampedArray([230, 220, 210, 255, 10, 20, 30, 255]);
    const original = bytes.slice(); applyCleanup(bytes, 'original'); expect(bytes).toEqual(original);
    applyCleanup(bytes, 'binary'); expect([...bytes]).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
  });
  it('escapes document Markdown and preserves page/line boundaries', () => {
    const output = markdownText(['# title\n<script> & [link](x)', 'Grüße']);
    expect(output).toContain('\\# title  \n\\<script\\>'); expect(output).toContain('## Page 2\n\nGrüße'); expect(output).not.toContain('<script>');
  });
  it('independently reopens invisible Unicode overlays on rotated and cropped pages', async () => {
    const doc = await PDFDocument.create(); doc.registerFontkit(fontkit); const font = await doc.embedFont(await readFile('public/fonts/DocFlowSans.woff'), { subset: true });
    for (const rotation of [0, 90, 180, 270]) { const p = doc.addPage([500, 700]); p.setCropBox(35, 55, 390, 540); p.setRotation(degrees(rotation)); }
    const view = await getDocument({ data: await doc.save() }).promise;
    try {
      for (let i = 0; i < 4; i++) {
        const vp = (await view.getPage(i + 1)).getViewport({ scale: 1 }), transform = rotationGeometry(vp.width, vp.height, 4.5);
        // Known word in corrected recognition coordinates, mapped through both transforms.
        const omitted = addOcrWords(doc.getPage(i), font, [{ text: 'Grüße Café', confidence: 99, x: 90, y: 100, w: 160, h: 28 }], (x, y) => { const original = transform.toSource(x, y), [px, py] = vp.convertToPdfPoint(original.x, original.y); return { x: px!, y: py! }; });
        expect(omitted).toBe(0);
      }
    } finally { await view.destroy(); }
    await mkdir('artifacts/r4', { recursive: true }); await writeFile('artifacts/r4/unicode-geometry.pdf', await doc.save());
    const measured = JSON.parse(execFileSync('python', ['-c', `import fitz,json
p=fitz.open('artifacts/r4/unicode-geometry.pdf')
result=[]
for page in p:
 text=page.get_text()
 traces=page.get_texttrace()
 pix=page.get_pixmap()
 result.append({'text':text.strip(),'invisible':all(t['type']==3 for t in traces),'ink':min(pix.samples),'bounds':all(page.rect.contains(fitz.Rect(t['bbox'])*page.rotation_matrix) for t in traces)})
print(json.dumps(result))`], { encoding: 'utf8' }));
    expect(measured).toHaveLength(4); for (const page of measured) expect(page).toMatchObject({ text: 'Grüße Café', invisible: true, ink: 255, bounds: true });
  });
});
