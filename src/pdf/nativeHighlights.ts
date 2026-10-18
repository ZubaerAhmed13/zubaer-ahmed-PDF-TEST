import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from 'pdf-lib';
import { displaySize, pdfBounds, toDisplay, toPdf, type EditObject, type PageFrame } from './editModel';
const n = PDFName.of;
function numbers(value: unknown, length: number): number[] | undefined {
    if (!(value instanceof PDFArray) || value.size() !== length)
        return;
    const result = value.asArray().map((_, i) => value.lookup(i));
    if (!result.every(v => v instanceof PDFNumber && Number.isFinite(v.asNumber())))
        return;
    return result.map(v => (v as PDFNumber).asNumber());
}
/** Only a single axis-aligned quad is represented by the editor's rectangular object model.
 * Unsupported geometry, visibility, flags and review threads stay in the source PDF.
 */
export function inspectNativeHighlights(doc: PDFDocument, frames: PageFrame[]): {
    objects: EditObject[];
    preserved: number;
} {
    const objects: EditObject[] = [];
    let preserved = 0;
    const repliedTo = new Set<string>();
    const references = new Map<string, number>();
    for (const page of doc.getPages()) {
        for (const ref of page.node.Annots()?.asArray() ?? []) {
            references.set(ref.toString(), (references.get(ref.toString()) ?? 0) + 1);
            const item = doc.context.lookup(ref);
            if (item instanceof PDFDict && item.has(n('IRT')))
                repliedTo.add(item.get(n('IRT'))!.toString());
        }
    }
    doc.getPages().forEach((page, index) => {
        for (const [i, ref] of (page.node.Annots()?.asArray() ?? []).entries()) {
            const item = doc.context.lookup(ref);
            if (!(item instanceof PDFDict) || item.get(n('Subtype'))?.toString() !== '/Highlight')
                continue;
            preserved++;
            try {
                if (!(ref instanceof PDFRef) || references.get(ref.toString()) !== 1 || item.has(n('IRT')) || item.has(n('OC')) || repliedTo.has(ref.toString()))
                    continue;
                const flags = item.lookup(n('F'));
                if (flags !== undefined && (!(flags instanceof PDFNumber) || !Number.isInteger(flags.asNumber()) || flags.asNumber() < 0 || flags.asNumber() > 1023 || (flags.asNumber() & ~4) !== 0))
                    continue;
                const quad = numbers(item.lookup(n('QuadPoints')), 8), rect = numbers(item.lookup(n('Rect')), 4);
                if (!quad || !rect)
                    continue;
                const xs = [quad[0]!, quad[2]!, quad[4]!, quad[6]!], ys = [quad[1]!, quad[3]!, quad[5]!, quad[7]!];
                const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
                if (maxX - minX < 8 || maxY - minY < 8 || rect[0]! > minX || rect[1]! > minY || rect[2]! < maxX || rect[3]! < maxY)
                    continue;
                const corners = new Set<string>();
                for (let p = 0; p < 4; p++) {
                    const x = xs[p]!, y = ys[p]!;
                    if ((Math.abs(x - minX) > .01 && Math.abs(x - maxX) > .01) || (Math.abs(y - minY) > .01 && Math.abs(y - maxY) > .01))
                        break;
                    corners.add(`${Math.abs(x - minX) < .01 ? 0 : 1}:${Math.abs(y - minY) < .01 ? 0 : 1}`);
                }
                if (corners.size !== 4)
                    continue;
                // Admit the paired-edge order used by Acrobat, PDF.js and our writer.
                // A corner set alone also accepts crossed/malformed permutations.
                if (Math.abs(xs[3]! - (xs[1]! + xs[2]! - xs[0]!)) > .01 ||
                    Math.abs(ys[3]! - (ys[1]! + ys[2]! - ys[0]!)) > .01)
                    continue;
                const frame = frames[index]!, a = toDisplay(frame, minX, minY), b = toDisplay(frame, maxX, maxY), size = displaySize(frame);
                const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), width = Math.abs(a[0] - b[0]), height = Math.abs(a[1] - b[1]);
                if (x < 0 || y < 0 || x + width > size.width + .01 || y + height > size.height + .01)
                    continue;
                const c = item.has(n('C')) ? numbers(item.lookup(n('C')), 3) : [1, 1, 0];
                if (!c || c.some(v => v < 0 || v > 1))
                    continue;
                const ca = item.lookup(n('CA'));
                if (ca !== undefined && (!(ca instanceof PDFNumber) || !Number.isFinite(ca.asNumber()) || ca.asNumber() < 0 || ca.asNumber() > 1))
                    continue;
                const contents = item.lookup(n('Contents'));
                if (contents !== undefined && !(contents instanceof PDFString || contents instanceof PDFHexString))
                    continue;
                objects.push({ id: `highlight-${index}-${i}`, originalId: `${index}:${ref}`, page: index + 1, kind: 'native-highlight', x, y, width, height, text: contents?.decodeText() ?? '', color: '#' + c.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join(''), size: 16, opacity: ca instanceof PDFNumber ? ca.asNumber() : 1 });
                preserved--;
            }
            catch {
                // An unsupported annotation must not prevent editing unrelated page content.
            }
        }
    });
    return { objects, preserved };
}
/** Removes only explicitly admitted source identities and their popup references. */
export function removeAnnotationReferences(doc: PDFDocument, removed: Set<string>): void {
    doc.getPages().forEach((page, index) => {
        const annots = page.node.Annots();
        for (let i = (annots?.size() ?? 0) - 1; i >= 0; i--) {
            const ref = annots!.get(i), item = doc.context.lookup(ref);
            if (removed.has(`${index}:${ref}`) || (item instanceof PDFDict && item.get(n('Subtype'))?.toString() === '/Popup' && removed.has(`${index}:${item.get(n('Parent'))}`)))
                annots!.remove(i);
        }
    });
}
export function writeNativeHighlight(doc: PDFDocument, frame: PageFrame, o: EditObject, prior?: PDFDict): void {
    const box = pdfBounds(frame, o), opacity = o.opacity ?? .28;
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)
        throw new Error('Invalid highlight opacity.');
    const c = [1, 3, 5].map(start => parseInt(o.color.slice(start, start + 2), 16) / 255);
    const appearance = doc.context.register(doc.context.flateStream(`q /GS0 gs ${c.join(' ')} rg 0 0 ${box.width} ${box.height} re f Q`, {
        Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: [0, 0, box.width, box.height], Resources: { ExtGState: { GS0: { Type: 'ExtGState', ca: opacity, CA: opacity, BM: 'Multiply' } } }
    }));
    const item = prior ?? doc.context.obj({ Type: 'Annot', Subtype: 'Highlight', T: PDFHexString.fromText('DocFlow'), NM: PDFHexString.fromText(o.id), F: 4, P: doc.getPage(o.page - 1).ref });
    item.set(n('Rect'), doc.context.obj([box.x, box.y, box.x + box.width, box.y + box.height]));
    item.set(n('QuadPoints'), doc.context.obj([[o.x, o.y], [o.x + o.width, o.y], [o.x, o.y + o.height], [o.x + o.width, o.y + o.height]].flatMap(([x, y]) => toPdf(frame, x!, y!))));
    item.set(n('Contents'), PDFHexString.fromText(o.text ?? ''));
    item.set(n('C'), doc.context.obj(c));
    item.set(n('CA'), doc.context.obj(opacity));
    item.set(n('AP'), doc.context.obj({ N: appearance }));
    item.set(n('M'), PDFString.of(`D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`));
    if (!prior) {
        const page = doc.getPage(o.page - 1), annots = page.node.Annots() ?? doc.context.obj([]);
        annots.push(doc.context.register(item));
        page.node.set(n('Annots'), annots);
    }
}
