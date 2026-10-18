import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { preservationCorpus } from './pdfCorpus';
export async function riskyCorpus(emptySignature = false): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await preservationCorpus());
  const action = doc.context.register(doc.context.obj({ S: 'JavaScript', JS: PDFString.of('throw new Error("never run")') }));
  doc.catalog.set(PDFName.of('OpenAction'), action);
  doc.catalog.set(PDFName.of('MarkInfo'), doc.context.obj({ Marked: true }));
  doc.catalog.set(PDFName.of('StructTreeRoot'), doc.context.obj({ Type: 'StructTreeRoot', K: [] }));
  const sig = doc.context.register(doc.context.obj(emptySignature ? { FT: 'Sig' } : {
    Type: 'Sig', ByteRange: [0, 100, 200, 50], Contents: PDFString.of('synthetic signature'),
    Reference: [{ TransformMethod: 'DocMDP' }]
  }));
  if (!emptySignature) doc.catalog.set(PDFName.of('Perms'), doc.context.obj({ DocMDP: sig }));
  doc.getPage(0).node.addAnnot(doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [1,1,10,10], A: { S: 'URI', URI: PDFString.of('javascript:alert(1)') }
  })));
  return doc.save();
}

