import {validateNativeRaster,addEncodedBytes} from './resourceBudget';
import {abortable,cancellationScope} from './pdfCancellation';
import {openLocalPdf} from './pdfjsPolicy';
import {PdfOperationError} from './errors';
import * as pdfjs from 'pdfjs-dist';
import type {PDFPageProxy} from 'pdfjs-dist';
pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();

interface RasterImageSource {
  width: number;
  height: number;
  data?: Uint8Array | Uint8ClampedArray;
  bitmap?: ImageBitmap;
  kind?: number;
}

export interface ExtractedImageRecord {
  page: number;
  index: number;
  source: 'xobject' | 'inline';
  sourceId: string;
  width: number;
  height: number;
  filename: string;
}
export type EmbeddedImage=ExtractedImageRecord&{blob:Blob};
export type SkippedEmbeddedImage={page:number;sourceId:string;reason:string};
export type EmbeddedImageResult={blob:Blob;count:number;images:EmbeddedImage[];skipped:SkippedEmbeddedImage[]};

function isImageBitmap(value: unknown): value is ImageBitmap {
  return typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap;
}

async function resolvePageObject(page: PDFPageProxy, id: string,signal:AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  const objects = (id.startsWith('g_')?page.commonObjs:page.objs) as unknown as {
    get: (objectId: string, callback?: (value: unknown) => void) => unknown;
    has?: (objectId: string) => boolean;
  };

  if (objects.has?.(id)) {
    try {
      const ready = objects.get(id);
      if (ready !== undefined && ready !== null) return ready;
    } catch {
      // Fall through to the callback form. PDF.js may reject a synchronous get
      // even when an object is about to become available from its worker.
    }
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup=():void=>{window.clearTimeout(timeout);signal.removeEventListener('abort',abort);};
    const abort=():void=>{if(settled)return;settled=true;cleanup();reject(new DOMException('Operation cancelled','AbortError'));};
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`IMAGE_OBJECT_TIMEOUT:${id}`));
    }, 8000);
    const finish = (value: unknown): void => {
      if (settled || value === undefined || value === null) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    signal.addEventListener('abort',abort,{once:true});
    try {
      const immediate = objects.get(id, finish);
      // PDFObjects#get returns null while the worker-owned object is unresolved.
      // Do not treat that sentinel as the image; wait for the callback instead.
      if (immediate !== undefined && immediate !== null) finish(immediate);
    } catch (error) {
      settled=true;cleanup();
      reject(error);
    }
  });
}

function normalizeRasterSource(value: unknown): RasterImageSource | ImageBitmap | null {
  if (isImageBitmap(value)) return value;
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<RasterImageSource>;
  if (candidate.bitmap && isImageBitmap(candidate.bitmap)) return candidate.bitmap;
  if (typeof candidate.width !== 'number' || typeof candidate.height !== 'number') return null;
  if (!candidate.data || !(candidate.data instanceof Uint8Array || candidate.data instanceof Uint8ClampedArray)) return null;
  return { width: candidate.width, height: candidate.height, data: candidate.data,kind:candidate.kind };
}

function canvasFromRaster(source: RasterImageSource | ImageBitmap): HTMLCanvasElement | null {
  const width = source instanceof ImageBitmap ? source.width : source.width;
  const height = source instanceof ImageBitmap ? source.height : source.height;
  validateNativeRaster(width,height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {canvas.width=canvas.height=1;return null;}

  if (isImageBitmap(source)) {
    context.drawImage(source, 0, 0);
    return canvas;
  }

  const bytes = source.data;
  if (!bytes) {canvas.width=canvas.height=1;return null;}
  const pixels = width * height;
  const rgba = new Uint8ClampedArray(pixels * 4);

  if (source.kind!==1&&bytes.length === pixels * 4) {
    rgba.set(bytes);
  } else if (source.kind!==1&&bytes.length === pixels * 3) {
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      const sourceOffset = pixel * 3;
      const targetOffset = pixel * 4;
      rgba[targetOffset] = bytes[sourceOffset] ?? 0;
      rgba[targetOffset + 1] = bytes[sourceOffset + 1] ?? 0;
      rgba[targetOffset + 2] = bytes[sourceOffset + 2] ?? 0;
      rgba[targetOffset + 3] = 255;
    }
  } else if (source.kind!==1&&bytes.length === pixels) {
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      const value = bytes[pixel] ?? 0;
      const targetOffset = pixel * 4;
      rgba[targetOffset] = value;
      rgba[targetOffset + 1] = value;
      rgba[targetOffset + 2] = value;
      rgba[targetOffset + 3] = 255;
    }
  } else if (bytes.length === Math.ceil(width / 8) * height) {
    const stride = Math.ceil(width / 8);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const byte = bytes[y * stride + (x >> 3)] ?? 0;
        const value = ((byte >> (7 - (x & 7))) & 1) === 1 ? 255 : 0;
        const targetOffset = (y * width + x) * 4;
        rgba[targetOffset] = value;
        rgba[targetOffset + 1] = value;
        rgba[targetOffset + 2] = value;
        rgba[targetOffset + 3] = 255;
      }
    }
  } else {
    canvas.width=canvas.height=1;return null;
  }

  context.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas;
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG_ENCODING_FAILED')), 'image/png');
  });
}

export async function extractEmbeddedImages(
  buffer: ArrayBuffer,
  onProgress: (message: string, percent: number) => void,
  isCancelled: () => boolean
): Promise<EmbeddedImageResult> {
  const [{ default: JSZip }] = await Promise.all([import('jszip')]);
  const scope=cancellationScope(isCancelled);
  const loadingTask = (()=>{try{return openLocalPdf(buffer,scope.signal);}catch(error){scope.dispose();throw error;}})();
  const document = await loadingTask.promise.catch(error=>{scope.dispose();throw error;});
  const zip = new JSZip();
  const manifest: ExtractedImageRecord[] = [];
  const images:EmbeddedImage[]=[],skipped:SkippedEmbeddedImage[]=[];
  const budget=():void=>{if(images.length+skipped.length>=1000)throw new PdfOperationError('RESOURCE_LIMIT','Embedded image export supports up to 1,000 image records.');};
  const skip=(page:number,sourceId:string,reason:string):void=>{budget();skipped.push({page,sourceId,reason});};
  let extracted = 0;
  let encodedBytes=0;

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (isCancelled()) throw new DOMException('Operation cancelled', 'AbortError');
      const page = await document.getPage(pageNumber);
      try {
        const operatorList = await abortable(page.getOperatorList(),scope.signal,()=>{void document.destroy().catch(()=>{});});
        const seenPageObjects = new Set<string>();
        let pageImageIndex = 0;

        for (let operationIndex = 0; operationIndex < operatorList.fnArray.length; operationIndex += 1) {
          if (isCancelled()) throw new DOMException('Operation cancelled', 'AbortError');
          const operation = operatorList.fnArray[operationIndex];
          const args = operatorList.argsArray[operationIndex] ?? [];
          let rawSource: unknown = null;
          let source: 'xobject' | 'inline' = 'inline';
          let sourceId = `inline-${operationIndex + 1}`;
          let nativeSize:{width:number;height:number}|null=null;

          if (operation === pdfjs.OPS.paintImageXObject) {
            source = 'xobject';
            sourceId = String(args[0] ?? 'unknown');
            if (seenPageObjects.has(sourceId)) continue;
            seenPageObjects.add(sourceId);
            // getOperatorList uses PDF.js's unoptimised OPLIST intent. These
            // dimensions come from the source dictionary before ImageResizer.
            nativeSize={width:Number(args[1]),height:Number(args[2])};
            validateNativeRaster(nativeSize.width,nativeSize.height);
            try { rawSource = await resolvePageObject(page, sourceId,scope.signal); }
            catch {scope.signal.throwIfAborted();skip(pageNumber,sourceId,'Decoded image object was unavailable.');continue;}
          } else if (operation === pdfjs.OPS.paintInlineImageXObject) {
            rawSource = args[0];
          } else {
            if(operation===pdfjs.OPS.paintImageXObjectRepeat)skip(pageNumber,String(args[0]??sourceId),'Optimised repeated image did not expose original pixel dimensions.');
            else if(operation===pdfjs.OPS.paintInlineImageXObjectGroup)skip(pageNumber,sourceId,'Grouped inline image atlas is not yet supported.');
            else if([pdfjs.OPS.paintImageMaskXObject,pdfjs.OPS.paintImageMaskXObjectGroup,pdfjs.OPS.paintImageMaskXObjectRepeat,pdfjs.OPS.paintSolidColorImageMask].includes(operation!))skip(pageNumber,sourceId,'Image mask is not exported as an ordinary embedded image.');
            continue;
          }

          const normalized = normalizeRasterSource(rawSource);
          if (!normalized){skip(pageNumber,sourceId,'Unsupported decoded image layout.');continue;}
          if(nativeSize&&(normalized.width!==nativeSize.width||normalized.height!==nativeSize.height))throw new PdfOperationError('RESOURCE_LIMIT','The browser changed embedded image dimensions; native-resolution extraction is unavailable for this image.');
          budget();
          const canvas = canvasFromRaster(normalized);
          if (!canvas){skip(pageNumber,sourceId,'Unsupported decoded image layout or unavailable canvas.');continue;}
          try {
          const png = await abortable(canvasToPng(canvas),scope.signal);
          scope.signal.throwIfAborted();
          encodedBytes=addEncodedBytes(encodedBytes,png.size);
          pageImageIndex += 1;
          extracted += 1;
          const filename = `page-${String(pageNumber).padStart(3, '0')}-image-${String(pageImageIndex).padStart(3, '0')}.png`;
          zip.file(filename, png);
          const record:ExtractedImageRecord={
            page: pageNumber,
            index: pageImageIndex,
            source,
            sourceId,
            width: canvas.width,
            height: canvas.height,
            filename
          };
          manifest.push(record);images.push({...record,blob:png});
          canvas.width = 1;
          canvas.height = 1;
          } finally {canvas.width=canvas.height=1;}
        }
      } finally {
        page.cleanup();
      }
      onProgress(`Scanned page ${pageNumber} of ${document.numPages}`, (pageNumber / document.numPages) * 90);
    }
  } finally {
    scope.dispose(); await document.destroy();
  }

  if (extracted === 0) throw new Error('No decoded embedded raster images were found. Image masks, vector graphics, and whole-page rendering are intentionally not treated as embedded-image extraction.');

  zip.file('manifest.json', JSON.stringify({
    tool: 'DocFlow Professional Extract Images',
    extractedImages: extracted,
    skippedRasterOperations:skipped.length,
    skipped,
    note: 'Images are exported from PDF.js decoded raster data as PNG. Original JPEG/JPX/compressed stream bytes and source metadata are not claimed to be preserved.',
    images: manifest
  }, null, 2));
  onProgress('Packaging extracted images', 95);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },()=>{if(isCancelled())throw new DOMException('Operation cancelled','AbortError');});
  if(isCancelled())throw new DOMException('Operation cancelled','AbortError');
  return { blob, count: extracted,images,skipped };
}

