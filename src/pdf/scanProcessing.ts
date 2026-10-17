/** Bounded, local image correction shared by scan import and OCR. */
export interface Point { x: number; y: number }
export type Cleanup = 'original' | 'grayscale' | 'contrast' | 'binary';
export interface ScanOptions { rotation: number; deskew: number; cleanup: Cleanup }
export const defaultScanOptions: ScanOptions = { rotation: 0, deskew: 0, cleanup: 'original' };
export function scanOptions(values: Record<string, unknown>): ScanOptions {
  const rotation = Number(values.rotation ?? 0), deskew = Number(values.deskew ?? 0);
  if (![0, 90, 180, 270].includes(rotation) || !Number.isFinite(deskew) || Math.abs(deskew) > 15) throw Error('Choose a quarter-turn rotation and a deskew angle between −15° and 15°.');
  const cleanup = String(values.cleanup ?? 'original');
  if (!['original', 'grayscale', 'contrast', 'binary'].includes(cleanup)) throw Error('Choose a supported cleanup filter.');
  return { rotation, deskew, cleanup: cleanup as Cleanup };
}
export function rotationGeometry(width: number, height: number, degrees: number) {
  const angle = degrees * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const w = Math.ceil(Math.abs(width * c) + Math.abs(height * s) - 1e-8);
  const h = Math.ceil(Math.abs(width * s) + Math.abs(height * c) - 1e-8);
  return { width: w, height: h, angle, toSource: (x: number, y: number): Point => ({ x: c * (x - w / 2) + s * (y - h / 2) + width / 2, y: -s * (x - w / 2) + c * (y - h / 2) + height / 2 }) };
}
export function applyCleanup(data: Uint8ClampedArray, mode: Cleanup): void {
  if (mode === 'original') return;
  const histogram = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) histogram[Math.round(.299 * data[i]! + .587 * data[i + 1]! + .114 * data[i + 2]!)]!++;
  const n = data.length / 4;
  let low = 0, high = 255, sum = 0;
  while (low < 254 && (sum += histogram[low]!) < n * .01) low++;
  sum = 0;
  while (high > low + 1 && (sum += histogram[high]!) < n * .01) high--;
  for (let i = 0; i < data.length; i += 4) {
    let v = .299 * data[i]! + .587 * data[i + 1]! + .114 * data[i + 2]!;
    if (mode === 'contrast' || mode === 'binary') v = Math.max(0, Math.min(255, (v - low) * 255 / Math.max(32, high - low)));
    if (mode === 'binary') v = v < 160 ? 0 : 255;
    data[i] = data[i + 1] = data[i + 2] = Math.round(v); data[i + 3] = 255;
  }
}
export function correctedCanvas(source: HTMLCanvasElement, options: ScanOptions) {
  const geometry = rotationGeometry(source.width, source.height, options.rotation + options.deskew);
  const canvas = document.createElement('canvas'); canvas.width = geometry.width; canvas.height = geometry.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
  if (!ctx) throw Error('Image correction is unavailable in this browser.');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(geometry.angle); ctx.drawImage(source, -source.width / 2, -source.height / 2); ctx.resetTransform();
  if (options.cleanup !== 'original') { const image = ctx.getImageData(0, 0, canvas.width, canvas.height); applyCleanup(image.data, options.cleanup); ctx.putImageData(image, 0, 0); }
  return { canvas, toSource: geometry.toSource };
}
/** Clockwise corners: top-left, top-right, bottom-right, bottom-left. */
export function perspectiveMap(corners: readonly Point[]): (u: number, v: number) => Point {
  if (corners.length !== 4 || corners.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw Error('Four valid crop corners are required.');
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!, b = corners[(i + 1) % 4]!, c = corners[(i + 2) % 4]!;
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 1) throw Error('Crop corners must form a clockwise, non-crossing document with enough area.');
  }
  const [a, b, c, d] = corners as [Point, Point, Point, Point];
  const dx = a.x - b.x + c.x - d.x, dy = a.y - b.y + c.y - d.y;
  const bx = b.x - c.x, by = b.y - c.y, cx = d.x - c.x, cy = d.y - c.y;
  const det = bx * cy - cx * by;
  const g = (dx * cy - cx * dy) / det, h = (bx * dy - dx * by) / det;
  return (u, v) => { const z = g * u + h * v + 1; return { x: ((b.x - a.x + g * b.x) * u + (d.x - a.x + h * d.x) * v + a.x) / z, y: ((b.y - a.y + g * b.y) * u + (d.y - a.y + h * d.y) * v + a.y) / z }; };
}
export async function cropPerspective(source: HTMLCanvasElement, corners: readonly Point[], signal: AbortSignal): Promise<HTMLCanvasElement> {
  const map = perspectiveMap(corners);
  const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
  const width = Math.ceil(Math.max(distance(corners[0]!, corners[1]!), distance(corners[3]!, corners[2]!)));
  const height = Math.ceil(Math.max(distance(corners[0]!, corners[3]!), distance(corners[1]!, corners[2]!)));
  if (width < 16 || height < 16 || width * height > 8_000_000) throw Error('Crop must be at least 16 pixels wide and high and at most 8 megapixels.');
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!, input = source.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, source.width, source.height).data, output = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    if (y % 48 === 0) { signal.throwIfAborted(); await new Promise<void>(resolve => setTimeout(resolve, 0)); }
    for (let x = 0; x < width; x++) {
      const p = map((x + .5) / width, (y + .5) / height), sx = Math.max(0, Math.min(source.width - 1, p.x - .5)), sy = Math.max(0, Math.min(source.height - 1, p.y - .5));
      const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy, o = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const sample = (px: number, py: number): number => input[(Math.min(source.height - 1, py) * source.width + Math.min(source.width - 1, px)) * 4 + channel]!;
        output.data[o + channel] = (1 - fy) * ((1 - fx) * sample(ix, iy) + fx * sample(ix + 1, iy)) + fy * ((1 - fx) * sample(ix, iy + 1) + fx * sample(ix + 1, iy + 1));
      }
      output.data[o + 3] = 255;
    }
  }
  ctx.putImageData(output, 0, 0); return canvas;
}
export async function imageCanvas(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file), img = new Image();
  try {
    img.src = url; await img.decode();
    if (img.naturalWidth * img.naturalHeight > 80_000_000) throw Error('This image is too large to correct safely. Resize it below 80 megapixels first.');
    const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight), Math.sqrt(4_000_000 / (img.naturalWidth * img.naturalHeight)));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d', { alpha: false })!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height); return canvas;
  } finally { URL.revokeObjectURL(url); }
}
export const canvasBlob = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('Could not encode the corrected image.')), 'image/png'));
