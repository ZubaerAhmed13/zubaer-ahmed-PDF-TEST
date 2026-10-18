import { PdfOperationError } from './errors';
export const MAX_FILE_BYTES = 150 * 1048576;
export const MAX_TOTAL_BYTES = 250 * 1048576;
export const MAX_PAGES = 1000;
export const MAX_PAGE_POINTS = 14400;
export const MAX_IMAGE_PIXELS = 80_000_000;
export const WORKER_TIME_LIMIT_MS = 120000;
/** Options for the pinned PDF.js 4.10.38 API. stopAtErrors prevents silently omitted oversized images. */
export const SAFE_PDF_OPTIONS = { isEvalSupported: false, enableXfa: false, stopAtErrors: true, maxImageSize: MAX_IMAGE_PIXELS, canvasMaxAreaInBytes: 64_000_000, useWorkerFetch: false } as const;
export function validateInputBudget(sizes: readonly number[]): void {
  if (sizes.some(n => !Number.isFinite(n) || n < 0 || n > MAX_FILE_BYTES)) throw new PdfOperationError('RESOURCE_LIMIT','Maximum input file size is 150 MB.');
  if (sizes.reduce((sum,n) => sum+n,0) > MAX_TOTAL_BYTES) throw new PdfOperationError('RESOURCE_LIMIT','Maximum combined input size is 250 MB; use smaller batches.');
}
export function fitRaster(width:number,height:number,scale:number,maxPixels=16_000_000,maxDimension=8192): {width:number;height:number;scale:number} {
  if (![width,height].every(n => Number.isFinite(n) && n > 0 && n <= MAX_PAGE_POINTS) || !Number.isFinite(scale) || scale <= 0)
    throw new PdfOperationError('RESOURCE_LIMIT','Invalid or excessive page dimensions; maximum is 14,400 points per dimension.');
  const safeScale = Math.min(scale,maxDimension/Math.max(width,height),Math.sqrt(maxPixels/(width*height)));
  return {scale:safeScale,width:Math.max(1,Math.floor(width*safeScale)),height:Math.max(1,Math.floor(height*safeScale))};
}
let active = 0;
export function acquireWorkerSlot(): () => void {
  if (active >= 4) throw new PdfOperationError('RESOURCE_LIMIT','Four document workers are already active. Wait or cancel an operation.');
  ++active; let released=false;
  return () => { if (!released) { released=true; --active; } };
}
