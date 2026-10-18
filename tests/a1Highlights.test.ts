import { it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFDict, PDFHexString, PDFString, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { applyDirectEdit, inspectDirectEdit } from '../src/pdf/directEdit';
import { emptyPlan, type EditObject } from '../src/pdf/editModel';
import type { InputFile } from '../src/pdf/types';
import { normalizePdfError } from '../src/pdf/errors';
const n = PDFName.of;
const input = (bytes: Uint8Array | ArrayBuffer): InputFile => ({ name: 'synthetic.pdf', type: 'application/pdf', buffer: new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.slice()).buffer });
const highlight = (page = 1): EditObject => ({ id: `review-${page}`, page, kind: 'native-highlight', x: 40, y: 65, width: 100, height: 35, color: '#ffcc33', size: 16, text: 'Review this region ✓' });
const objects = async (file: InputFile): Promise<EditObject[]> => JSON.parse(String((await inspectDirectEdit([file])).info!.comments));
async function fixture(): Promise<InputFile> {
    const doc = await PDFDocument.create();
    for (const angle of [0, 90, 180, 270]) {
        const page = doc.addPage([500, 700]);
        page.setCropBox(35, 55, 390, 540);
        page.setRotation(degrees(angle));
        page.drawText('ORIGINAL searchable text', { x: 90, y: 500, size: 12 });
    }
    doc.getPage(0).node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [80, 450, 180, 470], A: { S: 'URI', URI: PDFString.of('https://example.com/') } })));
    const form = doc.getForm().createTextField('KeepField');
    form.setText('Unchanged');
    form.addToPage(doc.getPage(3), { x: 90, y: 400, width: 100, height: 25 });
    doc.setTitle('Synthetic A1 preservation');
    const outline = doc.context.obj({ Type: 'Outlines', Count: 1 }), outlineRef = doc.context.register(outline);
    const item = doc.context.register(doc.context.obj({ Title: PDFHexString.fromText('Retained bookmark'), Parent: outlineRef, Dest: [doc.getPage(2).ref, PDFName.of('Fit')] }));
    outline.set(n('First'), item);
    outline.set(n('Last'), item);
    doc.catalog.set(n('Outlines'), outlineRef);
    doc.catalog.set(n('PageLabels'), doc.context.obj({ Nums: [0, { S: 'r' }] }));
    return input(await doc.save());
}
it('exports actual Highlight annotations with independent rotated/cropped pixels, searchable content and editable comments', async () => {
    const file = await fixture(), before = new Uint8Array(file.buffer).slice(), plan = emptyPlan();
    plan.objects = [1, 2, 3, 4].map(highlight);
    const out = (await applyDirectEdit([file], { plan })).outputs[0]!.buffer;
    const doc = await PDFDocument.load(out), original = await PDFDocument.load(file.buffer);
    expect(doc.getTitle()).toBe('Synthetic A1 preservation');
    expect(doc.getForm().getTextField('KeepField').getText()).toBe('Unchanged');
    for (const key of ['Outlines', 'PageLabels'])
        expect(doc.catalog.lookup(n(key))!.toString()).toBe(original.catalog.lookup(n(key))!.toString());
    for (let i = 0; i < 4; i++)
        expect(doc.getPage(i).node.Contents()!.toString()).toBe(original.getPage(i).node.Contents()!.toString());
    const parsed = await getDocument({ data: new Uint8Array(out).slice() }).promise;
    try {
        for (let p = 1; p <= 4; p++) {
            const page = await parsed.getPage(p), annots = await page.getAnnotations();
            const marks = annots.filter(a => a.subtype === 'Highlight');
            expect(marks).toHaveLength(1);
            expect(marks[0]!.contentsObj.str).toBe('Review this region ✓');
            expect((await page.getTextContent()).items.map(x => 'str' in x ? x.str : '').join(' ')).toContain('ORIGINAL searchable text');
            if (p === 1)
                expect(annots.some(a => a.subtype === 'Link')).toBe(true);
        }
    }
    finally {
        await parsed.destroy();
    }
    const imported = await objects(input(out));
    expect(imported).toHaveLength(4);
    for (const o of imported)
        expect(o).toMatchObject({ kind: 'native-highlight', x: 40, y: 65, width: 100, height: 35, color: '#ffcc33' });
    expect(new Uint8Array(file.buffer)).toEqual(before);
    await mkdir('artifacts/a1', { recursive: true });
    await writeFile('artifacts/a1/native-highlights.pdf', new Uint8Array(out));
    const evidence = execFileSync('python', ['scripts/verify-a1-highlights.py'], { encoding: 'utf8' });
    expect(JSON.parse(evidence).independent_edit_reopen).toBe(true);
    await writeFile('artifacts/a1/independent-verification.json', evidence);
    const independent = await objects(input(await readFile('artifacts/a1/independently-edited-highlights.pdf')));
    expect(independent).toHaveLength(4);
    for (const object of independent)
        expect(object).toMatchObject({ color: '#00ff00', text: 'Edited and saved in independent MuPDF' });
});
it('reimports, updates and deletes supported native marks without baking their old appearance into the editor preview', async () => {
    const file = await fixture(), plan = emptyPlan();
    plan.objects = [highlight()];
    const out = input((await applyDirectEdit([file], { plan })).outputs[0]!.buffer), doc = await PDFDocument.load(out.buffer);
    const ref = doc.getPage(0).node.Annots()!.get(1), mark = doc.context.lookup(ref, PDFDict);
    mark.set(n('T'), PDFHexString.fromText('External reviewer'));
    const popup = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Popup', Parent: ref, Rect: [100, 200, 200, 300] }));
    mark.set(n('Popup'), popup);
    doc.getPage(0).node.addAnnot(popup);
    const source = input(await doc.save()), inspected = await inspectDirectEdit([source]);
    expect(inspected.outputs).toHaveLength(1);
    const preview = await PDFDocument.load(inspected.outputs[0]!.buffer);
    expect(preview.getPage(0).node.Annots()!.size()).toBe(1); // link stays, editable mark/popup are overlay only
    plan.objects = JSON.parse(String(inspected.info!.comments));
    const same = await PDFDocument.load((await applyDirectEdit([source], { plan })).outputs[0]!.buffer);
    expect(same.context.lookup(ref, PDFDict).toString()).toBe(mark.toString());
    const originalId = plan.objects[0]!.originalId!;
    Object.assign(plan.objects[0]!, { x: 80, y: 110, width: 120, height: 28, color: '#33cc66', text: 'Revised externally authored mark' });
    const revised = input((await applyDirectEdit([source], { plan })).outputs[0]!.buffer);
    expect((await objects(revised))[0]).toMatchObject({ x: 80, y: 110, width: 120, height: 28, color: '#33cc66', text: 'Revised externally authored mark' });
    const edited = await PDFDocument.load(revised.buffer), dict = edited.context.lookup(ref, PDFDict);
    expect(dict.lookup(n('T'), PDFHexString).decodeText()).toBe('External reviewer');
    expect(dict.get(n('Popup'))!.toString()).toBe(popup.toString());
    expect(dict.get(n('AP'))!.toString()).not.toBe(mark.get(n('AP'))!.toString());
    plan.objects = [];
    plan.removedComments = [originalId];
    const deleted = await PDFDocument.load((await applyDirectEdit([source], { plan })).outputs[0]!.buffer);
    expect(deleted.getPage(0).node.Annots()!.size()).toBe(1);
});
it('preserves unsupported, locked, hidden, threaded, layered and malformed highlights without offering them as editable', async () => {
    const doc = await PDFDocument.create(), page = doc.addPage([400, 500]);
    const base = { Type: 'Annot', Subtype: 'Highlight', Rect: [40, 300, 140, 325], QuadPoints: [40, 325, 140, 325, 40, 300, 140, 300], C: [1, 1, 0], Contents: PDFHexString.fromText('Preserve me') };
    const refs = [
        doc.context.register(doc.context.obj(base)),
        ...[{ F: 128 }, { F: 2 }, { QuadPoints: [...base.QuadPoints, ...base.QuadPoints] }, { QuadPoints: [40, 325, 140, 325, 50, 300, 140, 300] }, { OC: doc.context.obj({ Type: 'OCG', Name: PDFString.of('Layer') }) }, { QuadPoints: [40, PDFName.of('bad'), 140, 325, 40, 300, 140, 300] }].map(extra => doc.context.register(doc.context.obj({ ...base, ...extra })))
    ];
    refs.push(doc.context.register(doc.context.obj({ ...base, IRT: refs[0] })));
    for (const ref of refs)
        page.node.addAnnot(ref);
    const file = input(await doc.save()), inspected = await inspectDirectEdit([file]);
    expect(JSON.parse(String(inspected.info!.comments))).toEqual([]);
    expect(inspected.info!.preservedHighlights).toBe(8);
    const result = await PDFDocument.load((await applyDirectEdit([file], { plan: emptyPlan() })).outputs[0]!.buffer);
    expect(result.getPage(0).node.Annots()!.size()).toBe(refs.length);
    for (const ref of refs)
        expect(result.context.lookup(ref, PDFDict).toString()).toBe(doc.context.lookup(ref, PDFDict).toString());
    const bad = emptyPlan();
    bad.removedComments = [`0:${refs[1]}`];
    await expect(applyDirectEdit([file], { plan: bad })).rejects.toThrow('not editable');
});
it('rejects forged or duplicated source identities and invalid highlight geometry before export', async () => {
    const file = await fixture(), plan = emptyPlan();
    plan.objects = [highlight()];
    const source = input((await applyDirectEdit([file], { plan })).outputs[0]!.buffer);
    plan.objects = await objects(source);
    plan.objects.push({ ...plan.objects[0]!, id: 'copy' });
    await expect(applyDirectEdit([source], { plan })).rejects.toThrow('more than once');
    plan.objects = [{ ...highlight(), originalId: '0:999 0 R' }];
    await expect(applyDirectEdit([source], { plan })).rejects.toThrow('not editable');
    plan.objects = [{ ...highlight(), width: NaN }];
    await expect(applyDirectEdit([file], { plan })).rejects.toThrow('geometry');
});
it('keeps the existing baked-in region highlight export available', async () => {
    const file = await fixture(), plan = emptyPlan();
    plan.objects = [{ ...highlight(), kind: 'highlight' }];
    const out = await PDFDocument.load((await applyDirectEdit([file], { plan })).outputs[0]!.buffer);
    const annots = out.getPage(0).node.Annots()!;
    expect([...Array(annots.size())].some((_, i) => out.context.lookup(annots.get(i), PDFDict).get(n('Subtype'))?.toString() === '/Highlight')).toBe(false);
    expect(out.getPage(0).node.Contents()!.toString()).not.toBe((await PDFDocument.load(file.buffer)).getPage(0).node.Contents()!.toString());
});
it('leaves annotations with out-of-range flags untouched instead of truncating their flags into an editable value', async () => {
    const file = await fixture(), plan = emptyPlan();
    plan.objects = [highlight()];
    const doc = await PDFDocument.load((await applyDirectEdit([file], { plan })).outputs[0]!.buffer);
    const ref = doc.getPage(0).node.Annots()!.get(1);
    doc.context.lookup(ref, PDFDict).set(n('F'), doc.context.obj(4294967296));
    expect(await objects(input(await doc.save()))).toEqual([]);
});
it('preserves a highlight reference shared by pages rather than editing another page through the same dictionary', async () => {
    const file = await fixture(), plan = emptyPlan();
    plan.objects = [highlight()];
    const doc = await PDFDocument.load((await applyDirectEdit([file], { plan })).outputs[0]!.buffer);
    const ref = doc.getPage(0).node.Annots()!.get(1);
    doc.getPage(1).node.addAnnot(ref);
    const source = input(await doc.save()), inspected = await inspectDirectEdit([source]);
    expect(JSON.parse(String(inspected.info!.comments))).toEqual([]);
    expect(inspected.info!.preservedHighlights).toBe(2);
});
it('preserves crossed quad order rather than silently turning it into a rectangular highlight', async () => {
    const doc = await PDFDocument.create(), page = doc.addPage([400, 500]);
    const ref = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Highlight', Rect: [40, 300, 140, 325], QuadPoints: [40, 325, 140, 300, 140, 325, 40, 300], C: [1, 1, 0], Contents: PDFString.of('Crossed geometry') }));
    page.node.addAnnot(ref);
    const file = input(await doc.save()), inspected = await inspectDirectEdit([file]);
    expect(JSON.parse(String(inspected.info!.comments))).toEqual([]);
    expect(inspected.info!.preservedHighlights).toBe(1);
    const out = await PDFDocument.load((await applyDirectEdit([file], { plan: emptyPlan() })).outputs[0]!.buffer);
    expect(out.context.lookup(ref, PDFDict).toString()).toBe(doc.context.lookup(ref, PDFDict).toString());
});
it('refuses custom page units before offering or exporting inaccurately scaled editor objects', async () => {
    const file = await fixture(), doc = await PDFDocument.load(file.buffer);
    doc.getPage(0).node.set(n('UserUnit'), doc.context.obj(2));
    const source = input(await doc.save());
    await expect(inspectDirectEdit([source])).rejects.toThrow('custom page scale');
    expect(await inspectDirectEdit([source]).catch(normalizePdfError)).toMatchObject({
        code: 'UNSUPPORTED_PAGE_SCALE', message: expect.stringContaining('custom page scale')
    });
    const plan = emptyPlan();
    plan.objects = [highlight()];
    await expect(applyDirectEdit([source], { plan })).rejects.toThrow('custom page scale');
});
