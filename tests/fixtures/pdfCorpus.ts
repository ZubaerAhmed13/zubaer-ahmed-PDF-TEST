import { PDFDocument, PDFName, PDFString, StandardFonts, degrees, rgb } from 'pdf-lib';

/** Synthetic, non-personal corpus v1. Change the version if fixture semantics change. */
export const PDF_CORPUS_VERSION = 1;
const fixedDate = new Date('2026-01-01T00:00:00.000Z');
function stamp(doc: PDFDocument): void {
  doc.setCreationDate(fixedDate);
  doc.setModificationDate(fixedDate);
  doc.setTitle('DocFlow corpus v1 private title');
  doc.setAuthor('SYNTHETIC-PRIVATE-AUTHOR');
}

export async function redactionCorpus(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  stamp(doc);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const image = await doc.embedPng(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlRYpkAAAAASUVORK5CYII=', 'base64'));
  for (const rotation of [0, 90, 180, 270]) {
    const page = doc.addPage([420, 540]);
    page.setCropBox(40, 50, 320, 400);
    page.setRotation(degrees(rotation));
    page.drawRectangle({ x: 40, y: 50, width: 320, height: 400, color: rgb(.86, .94, .81) });
    page.drawText('SYNTHETIC SECRET', { x: 65, y: 330, size: 19, font });
    page.drawText('Public footer', { x: 65, y: 80, size: 16, font });
    // One shared XObject drawn more than once: redaction must not forward it.
    page.drawImage(image, { x: 70, y: 220, width: 40, height: 40 });
    page.drawImage(image, { x: 240, y: 120, width: 40, height: 40 });
  }
  const field = doc.getForm().createTextField('ConfidentialField');
  field.setText('SYNTHETIC-FORM-SECRET');
  field.addToPage(doc.getPage(0), { x: 70, y: 280, width: 210, height: 24 });
  await doc.attach(new TextEncoder().encode('SYNTHETIC-ATTACHMENT-SECRET'), 'private.txt');
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

export type RepairDamage = 'none' | 'wrong-startxref' | 'missing-xref' | 'missing-page';
export function repairCorpus(damage: RepairDamage = 'none'): Buffer {
  const stream = 'BT /F1 20 Tf 30 350 Td (DocFlow repair corpus v1) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 480] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let body = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
  });
  const xref = Buffer.byteLength(body);
  body += 'xref\n0 6\n0000000000 65535 f \n';
  body += offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  body += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  if (damage === 'wrong-startxref') body = body.replace(/startxref\n\d+/, 'startxref\n1');
  if (damage === 'missing-xref') body = body.replace(/xref\n0 6\n[\s\S]*?trailer\n/, 'trailer\n').replace(/startxref\n\d+/, 'startxref\n0');
  if (damage === 'missing-page') body = body.replace(/3 0 obj\n[\s\S]*?endobj\n/, '');
  return Buffer.from(body, 'ascii');
}

export async function preservationCorpus(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  stamp(doc);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const first = doc.addPage([320, 480]);
  const second = doc.addPage([480, 320]);
  first.drawText('First page retained text', { x: 25, y: 400, size: 16, font });
  second.drawText('Second page retained text', { x: 25, y: 250, size: 16, font });
  const field = doc.getForm().createTextField('Name');
  field.setText('Synthetic value');
  field.addToPage(first, { x: 25, y: 300, width: 150, height: 25 });
  const outline = doc.context.obj({ Type: 'Outlines' });
  const outlineRef = doc.context.register(outline);
  const bookmark = doc.context.obj({
    Title: PDFString.of('First section'), Parent: outlineRef,
    Dest: [first.ref, PDFName.of('Fit')]
  });
  const bookmarkRef = doc.context.register(bookmark);
  outline.set(PDFName.of('First'), bookmarkRef);
  outline.set(PDFName.of('Last'), bookmarkRef);
  outline.set(PDFName.of('Count'), doc.context.obj(1));
  doc.catalog.set(PDFName.of('Outlines'), outlineRef);
  doc.catalog.set(PDFName.of('PageLabels'), doc.context.obj({ Nums: [0, { S: 'r' }] }));
  await doc.attach(new TextEncoder().encode('Synthetic attachment'), 'example.txt');
  const link = doc.context.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [25, 380, 180, 405],
    Border: [0, 0, 0], A: { S: 'URI', URI: PDFString.of('https://example.org/') }
  });
  first.node.addAnnot(doc.context.register(link));
  return Buffer.from(await doc.save());
}
