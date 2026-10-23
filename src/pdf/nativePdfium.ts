import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import fontkit from '@pdf-lib/fontkit';
import { checkText } from './directEdit';
import { toDisplay, type PageFrame } from './editModel';
import { nativeEditError, validateNativePlan, type NativeInspection, type NativeObject, type ResolvedNativePlan } from './nativeModel';

export interface NativePdfium {
  inspect(source: Uint8Array, page: number, frame: PageFrame): Promise<NativeInspection>;
  apply(source: Uint8Array, plan: ResolvedNativePlan, frames: PageFrame[], font?: Uint8Array): Promise<Uint8Array>;
}
// Keep the small memory contract explicit: the SDK's ambient Emscripten types
// are dev-only and should not become an implicit runtime dependency.
interface Memory {
  HEAPU8: Uint8Array;
  wasmExports: { malloc(size: number): number; free(ptr: number): void };
  getValue(ptr: number, type: string): number;
  setValue(ptr: number, value: number, type: string): void;
  UTF16ToString(ptr: number, maxBytes?: number): string;
  UTF8ToString(ptr: number, maxBytes?: number): string;
  stringToUTF16(value: string, ptr: number, maxBytes: number): void;
}
const standardFonts = /^(Helvetica|Times-(Roman|Bold|Italic|BoldItalic)|Courier)(-(Bold|Oblique|BoldOblique))?$/;
async function fingerprint(source: Uint8Array): Promise<string> {
  if (!source.length || source.length > 150 * 1024 * 1024) throw nativeEditError('Choose a PDF up to 150 MB.');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', source.slice().buffer))].map(v => v.toString(16).padStart(2, '0')).join('');
}

export async function createNativePdfium(wasmBinary: Uint8Array): Promise<NativePdfium> {
  const p: WrappedPdfiumModule = await init({ wasmBinary });
  p.PDFiumExt_Init();
  const m = p.pdfium as unknown as Memory;
  const alloc = (n: number): number => {
    const ptr = m.wasmExports.malloc(n);
    if (!ptr) throw nativeEditError('The local PDF engine ran out of memory.');
    return ptr;
  };
  const free = (ptr: number): void => m.wasmExports.free(ptr);
  function withDocument<T>(source: Uint8Array, run: (doc: number) => T): T {
    if (!source.length || source.length > 150 * 1024 * 1024) throw nativeEditError('Choose a PDF up to 150 MB.');
    const ptr = alloc(source.length);
    let doc = 0;
    try {
      m.HEAPU8.set(source, ptr);
      doc = p.FPDF_LoadMemDocument(ptr, source.length, '');
      if (!doc) throw nativeEditError('This source PDF could not be opened for content editing.');
      if (p.FPDF_GetSignatureCount(doc) > 0) throw nativeEditError('Signed PDFs cannot be changed with the source editor. Use an unsigned original.');
      return run(doc);
    } finally { if (doc) p.FPDF_CloseDocument(doc); free(ptr); }
  }
  function withPage<T>(doc: number, pageNumber: number, run: (page: number, text: number) => T): T {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > p.FPDF_GetPageCount(doc)) throw nativeEditError('The source page does not exist.');
    const page = p.FPDF_LoadPage(doc, pageNumber - 1);
    if (!page) throw nativeEditError('The source page could not be opened.');
    let text = 0;
    try { text = p.FPDFText_LoadPage(page); if (!text) throw nativeEditError('The source text could not be inspected.'); return run(page, text); }
    finally { if (text) p.FPDFText_ClosePage(text); p.FPDF_ClosePage(page); }
  }
  function floats(count: number, run: (ptr: number) => void): number[] {
    const ptr = alloc(count * 4);
    try { m.HEAPU8.fill(0, ptr, ptr + count * 4); run(ptr); return Array.from({length: count}, (_, i) => m.getValue(ptr + i * 4, 'float')); }
    finally { free(ptr); }
  }
  function sourceText(object: number, textPage: number): string {
    const size = p.FPDFTextObj_GetText(object, textPage, 0, 0);
    if (!size || size > 20002) return '';
    const ptr = alloc(size);
    try { p.FPDFTextObj_GetText(object, textPage, ptr, size); return m.UTF16ToString(ptr, size); }
    finally { free(ptr); }
  }
  function fontName(object: number): string {
    const font = p.FPDFTextObj_GetFont(object), size = p.FPDFFont_GetBaseFontName(font, 0, 0);
    if (!size || size > 1024) return 'Unknown font';
    const ptr = alloc(size);
    try { p.FPDFFont_GetBaseFontName(font, ptr, size); return m.UTF8ToString(ptr, size); }
    finally { free(ptr); }
  }
  function matrix(object: number): number[] {
    return floats(6, ptr => { if (!p.FPDFPageObj_GetMatrix(object, ptr)) throw nativeEditError('This source object has no usable transform.'); });
  }
  function describe(object: number, index: number, pageNumber: number, textPage: number, frame: PageFrame): NativeObject {
    const type = p.FPDFPageObj_GetType(object), kind = type === 1 ? 'text' : type === 3 ? 'image' : 'other';
    const bounds = floats(4, ptr => { if (!p.FPDFPageObj_GetBounds(object, ptr, ptr + 4, ptr + 8, ptr + 12)) throw nativeEditError('Could not inspect source object bounds.'); });
    const a = toDisplay(frame, bounds[0]!, bounds[1]!), b = toDisplay(frame, bounds[2]!, bounds[3]!);
    const rect = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) };
    let reason: string | undefined;
    const transform = matrix(object);
    if (kind === 'other') reason = type === 5 ? 'Grouped content: edit the original authoring file.' : 'This source object type is not editable yet.';
    // PDFium returns an empty clip handle with CountPaths=-1 for no clip.
    // CountPaths=0 can contain inherited TEXT clips; testing >0 loses them.
    else if (p.FPDFClipPath_CountPaths(p.FPDFPageObj_GetClipPath(object)) >= 0) reason = 'Clipped content: edit the original authoring file.';
    else if (kind === 'image' && p.FPDFPageObj_HasTransparency(object)) reason = 'Source image transparency or blend effects cannot be preserved safely yet. Edit the original authoring file.';
    else if (transform.some(v => !Number.isFinite(v)) || Math.abs(transform[0]! * transform[3]! - transform[1]! * transform[2]!) < 1e-6) reason = 'This source object has an unsupported transform.';
    else if (kind === 'text' && (p.FPDFTextObj_GetTextRenderMode(object) !== 0 || Math.abs(transform[1]!) > 1e-6 || Math.abs(transform[2]!) > 1e-6)) reason = 'Rotated, stroked or invisible source text is not supported yet.';
    const text = kind === 'text' ? sourceText(object, textPage) : undefined;
    if (kind === 'text' && !text) reason = 'This source text has no reliable character mapping.';
    if (kind !== 'other' && p.FPDFPageObj_CountMarks(object)) reason = 'Tagged source content is not editable without rebuilding its accessibility structure.';
    return { id: `${pageNumber}:${index}`, page: pageNumber, kind, rect, ...(text !== undefined ? {text, font: fontName(object)} : {}), editable: !reason, ...(reason ? {reason} : {}) };
  }
  function setText(object: number, text: string): void {
    const bytes = (text.length + 1) * 2, ptr = alloc(bytes);
    try { m.stringToUTF16(text, ptr, bytes); if (!p.FPDFText_SetText(object, ptr)) throw nativeEditError('The source font cannot encode this replacement. Choose the DocFlow font explicitly.'); }
    finally { free(ptr); }
  }
  function save(doc: number): Uint8Array {
    const writer = p.PDFiumExt_OpenFileWriter();
    if (!writer) throw nativeEditError('Could not create the local PDF writer.');
    try {
      if (!p.FPDF_SaveAsCopy(doc, writer, 2)) throw nativeEditError('Could not save the edited source PDF.');
      const size = p.PDFiumExt_GetFileWriterSize(writer);
      if (size < 8 || size > 250 * 1024 * 1024) throw nativeEditError('The saved PDF exceeds the output budget.');
      const ptr = alloc(size);
      try { if (!p.PDFiumExt_GetFileWriterData(writer, ptr, size)) throw nativeEditError('Could not read the saved PDF.'); return m.HEAPU8.slice(ptr, ptr + size); }
      finally { free(ptr); }
    } finally { p.PDFiumExt_CloseFileWriter(writer); }
  }
  return {
    async inspect(source, pageNumber, frame) {
      const hash = await fingerprint(source);
      return withDocument(source, doc => withPage(doc, pageNumber, (page, text) => {
        const count = p.FPDFPage_CountObjects(page);
        if (count > 10000) throw nativeEditError('This page exceeds the 10,000 source-object inspection limit.');
        return { fingerprint: hash, page: pageNumber, frame, objects: Array.from({length: count}, (_, i) => describe(p.FPDFPage_GetObject(page, i), i, pageNumber, text, frame)) };
      }));
    },
    async apply(source, plan, frames, fontBytes) {
      validateNativePlan(plan);
      if (await fingerprint(source) !== plan.fingerprint) throw nativeEditError('The source fingerprint changed. Reopen the original PDF.');
      const output = withDocument(source, doc => {
        if (frames.length !== p.FPDF_GetPageCount(doc) || frames.length > 1000) throw nativeEditError('The source page frames do not match.');
        let fallbackFont = 0, fontPtr = 0;
        try {
          if (plan.edits.some(e => e.kind === 'text' && e.font === 'docflow')) {
            if (!fontBytes?.length || fontBytes.length > 8 * 1024 * 1024) throw nativeEditError('The DocFlow source font is missing or too large.');
            const font = fontkit.create(fontBytes);
            if (!('characterSet' in font)) throw nativeEditError('The source font must contain one font face.');
            for (const edit of plan.edits) if (edit.kind === 'text' && edit.font === 'docflow') {
              try { checkText(edit.text, new Set(font.characterSet)); }
              catch (error) { throw nativeEditError(error instanceof Error ? error.message : 'The selected font does not support this text.'); }
            }
            fontPtr = alloc(fontBytes.length); m.HEAPU8.set(fontBytes, fontPtr);
            fallbackFont = p.FPDFText_LoadFont(doc, fontPtr, fontBytes.length, 2, true);
            if (!fallbackFont) throw nativeEditError('The DocFlow source font could not be loaded.');
          }
          const pageNumbers = [...new Set(plan.edits.map(e => Number(e.id.split(':')[0])))];
          for (const number of pageNumbers) withPage(doc, number, (page, textPage) => {
            const changes = plan.edits.filter(e => Number(e.id.split(':')[0]) === number).map(edit => {
              const index = Number(edit.id.split(':')[1]), object = p.FPDFPage_GetObject(page, index);
              if (!object) throw nativeEditError('The source object no longer exists.');
              const item = describe(object, index, number, textPage, frames[number - 1]!);
              if (!item.editable) throw nativeEditError(item.reason);
              if (edit.kind !== 'remove' && edit.kind !== item.kind) throw nativeEditError('The source object kind does not match this change.');
              return {edit, object, item};
            });
            for (const {edit, object, item} of changes) {
              if (edit.kind === 'remove') {
                if (!p.FPDFPage_RemoveObject(page, object)) throw nativeEditError('Could not remove the source object.');
                p.FPDFPageObj_Destroy(object);
              } else if (edit.kind === 'text') {
                if (edit.font === 'original') {
                  const repertoire = new Set(item.text);
                  const ascii = standardFonts.test(item.font!) && !p.FPDFFont_GetIsEmbedded(p.FPDFTextObj_GetFont(object));
                  if ([...edit.text].some(c => !(ascii && c >= ' ' && c <= '~') && !repertoire.has(c))) throw nativeEditError('The source font cannot safely encode these characters. Choose the DocFlow font explicitly.');
                  setText(object, edit.text);
                } else {
                  if (p.FPDFPageObj_HasTransparency(object)) throw nativeEditError('Changing the font cannot preserve this source text’s transparency or blend effects. Keep the original font or edit the authoring file.');
                  const size = floats(1, ptr => { if (!p.FPDFTextObj_GetFontSize(object, ptr)) throw nativeEditError('Could not read the source font size.'); })[0]!;
                  let replacement = p.FPDFPageObj_CreateTextObj(doc, fallbackFont, size);
                  if (!replacement) throw nativeEditError('Could not create the replacement source text.');
                  try {
                    setText(replacement, edit.text);
                    const values = matrix(object), ptr = alloc(24), colorPtr = alloc(16);
                    try {
                      values.forEach((v, i) => m.setValue(ptr + i * 4, v, 'float'));
                      if (!p.FPDFPageObj_SetMatrix(replacement, ptr) || !p.FPDFPageObj_GetFillColor(object, colorPtr, colorPtr + 4, colorPtr + 8, colorPtr + 12) || !p.FPDFPageObj_SetFillColor(replacement, ...Array.from({length: 4}, (_, i) => m.getValue(colorPtr + i * 4, 'i32')) as [number, number, number, number])) throw nativeEditError('Could not preserve the source text appearance.');
                    } finally { free(ptr); free(colorPtr); }
                    replace(page, object, replacement); replacement = 0;
                  } finally { if (replacement) p.FPDFPageObj_Destroy(replacement); }
                }
              } else {
                const image = edit.image, ptr = alloc(image.rgba.length);
                let bitmap = 0, replacement = 0;
                try {
                  // PDFium bitmap format 4 is BGRA, with a straight alpha channel.
                  for (let i = 0; i < image.rgba.length; i += 4) { m.HEAPU8[ptr+i] = image.rgba[i+2]!; m.HEAPU8[ptr+i+1] = image.rgba[i+1]!; m.HEAPU8[ptr+i+2] = image.rgba[i]!; m.HEAPU8[ptr+i+3] = image.rgba[i+3]!; }
                  bitmap = p.FPDFBitmap_CreateEx(image.width, image.height, 4, ptr, image.width * 4);
                  replacement = p.FPDFPageObj_NewImageObj(doc);
                  if (!bitmap || !replacement || !p.FPDFImageObj_SetBitmap(0, 0, replacement, bitmap) || !p.FPDFImageObj_SetMatrix(replacement, ...matrix(object) as [number, number, number, number, number, number])) throw nativeEditError('Could not replace this source image.');
                  replace(page, object, replacement); replacement = 0;
                } finally { if (replacement) p.FPDFPageObj_Destroy(replacement); if (bitmap) p.FPDFBitmap_Destroy(bitmap); free(ptr); }
              }
            }
            if (!p.FPDFPage_GenerateContent(page)) throw nativeEditError('Could not regenerate the edited source page.');
          });
          return save(doc);
        } finally { if (fallbackFont) p.FPDFFont_Close(fallbackFont); if (fontPtr) free(fontPtr); }
      });
      // Reopen the saved bytes before returning them. A successful setter is
      // insufficient when a source font has an incomplete Unicode map.
      withDocument(output, doc => {
        for (const edit of plan.edits) if (edit.kind === 'text') {
          const [pageNumber, originalIndex] = edit.id.split(':').map(Number) as [number, number];
          const removedBefore = plan.edits.filter(e => e.kind === 'remove' && Number(e.id.split(':')[0]) === pageNumber && Number(e.id.split(':')[1]) < originalIndex).length;
          withPage(doc, pageNumber, (page, textPage) => {
            const object = p.FPDFPage_GetObject(page, originalIndex - removedBefore);
            if (!object || sourceText(object, textPage) !== edit.text) throw nativeEditError('The saved source font did not retain the replacement text. Choose the DocFlow font explicitly.');
          });
        }
      });
      return output;
    },
  };
  function replace(page: number, source: number, replacement: number): void {
    const index = Array.from({length: p.FPDFPage_CountObjects(page)}, (_, i) => i).find(i => p.FPDFPage_GetObject(page, i) === source);
    if (index === undefined || !p.FPDFPage_RemoveObject(page, source)) throw nativeEditError('Could not remove the replaced source object.');
    p.FPDFPageObj_Destroy(source);
    if (!p.FPDFPage_InsertObjectAtIndex(page, replacement, index)) throw nativeEditError('Could not preserve the source object order.');
  }
}
