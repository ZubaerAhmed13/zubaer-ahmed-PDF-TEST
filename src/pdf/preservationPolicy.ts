import type { DocumentInspection } from './documentInspection';
const pageCopy = new Set(['merge','split','remove-pages','extract-pages','organize']);
const readOnly = new Set(['preview','metadata','forms-inspect','direct-edit-inspect','text-search','compare','pdf-to-images','extract-images']);
export function preservationConsequences(tool: string, report?: DocumentInspection): string[] {
  const messages: string[] = [];
  if (tool === 'redact-secure') messages.push('Image-only export: all original text, vectors, annotations, links, bookmarks, labels, forms, attachments, metadata and accessibility tags are removed on every page.');
  else if (pageCopy.has(tool)) messages.push('Page-copy export: page fonts and vectors are retained. Document bookmarks, page labels, editable forms, attachments, metadata and accessibility tags are not preserved. Annotation and link references may need repair; review them in another viewer.');
  else if (readOnly.has(tool)) messages.push('Reading does not change the source PDF. Scripts, launch actions and embedded files are never executed by DocFlow previews; links are not opened automatically. Extracted text/images and comparison reports do not carry PDF structure.');
  else if (tool === 'images-to-pdf') messages.push('Creates a new PDF from image pixels. Source PDF structure is not reconstructed.');
  else if (tool === 'workflow' || tool === 'batch') messages.push('Each step has its own preservation limits. Page-copy steps lose document bookmarks, labels, editable forms, attachments, metadata and tags; later steps cannot restore them. Optimisation can change image pixels.');
  else messages.push('Whole-document rewrite: supported original fonts, vectors and catalog structures are carried forward. Complex references and accessibility semantics are not certified; review the exported copy. Original active content and attachments may be preserved—this operation does not sanitise the PDF.');
  if (tool === 'forms') messages.push('Flattening forms removes editable fields and retains their visible appearances. XFA is unsupported.');
  if (tool === 'compress') messages.push('Image recompression may be lossy. Unsupported image types are left unchanged.');
  if (tool === 'ocr') messages.push('OCR adds an approximate invisible text layer; original page visuals remain. Existing accessibility tags are not rebuilt for new text.');
  if (!readOnly.has(tool) && (report?.signed || report?.certified)) messages.push('Signature/certification structures detected. Rewriting invalidates existing digital signatures. DocFlow does not validate signer identity, certificate trust, certification permissions or signature integrity. Keep the signed original.');
  if (report?.activeContent.length) messages.push('Active content detected: ' + report.activeContent.join(', ') + '. Previews never execute it. A rewritten PDF may preserve it unless the entire document is raster-redacted.');
  if (report?.riskyLinks) messages.push(report.riskyLinks + ' non-HTTPS or unsafe link action(s) detected. Destinations are not opened or verified.');
  if (report?.features.includes('attachments')) messages.push('Embedded files detected. DocFlow does not open or scan their contents.');
  return messages;
}
