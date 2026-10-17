import { canvasBlob, correctedCanvas, cropPerspective, defaultScanOptions, imageCanvas, scanOptions, type Point, type ScanOptions } from '../pdf/scanProcessing';

interface Settings { options: ScanOptions; corners: Point[] }
const fullCorners = (): Point[] => [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
export function scanControls(): string {
  return `<label>Rotate clockwise<select name="rotation"><option value="0">0°</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label><label>Deskew clockwise (−15° to 15°)<input name="deskew" type="number" min="-15" max="15" step="0.1" value="0"></label><label>Image cleanup<select name="cleanup"><option value="original">Keep colours</option><option value="grayscale">Grayscale</option><option value="contrast">Contrast / background cleanup</option><option value="binary">Black & white</option></select></label>`;
}
export function mountScanReview(host: HTMLElement, files: () => File[], added: (files: File[]) => void) {
  const saved = new Map<File, Settings>();
  let urls: string[] = [], generation = 0, disposed = false;
  let controller: AbortController | null = null;
  host.innerHTML = `<details open><summary>Scan & photo correction</summary><p>Choose JPEG or PNG photos, or use the camera action. Camera support depends on your device picker. Correct each photo, review both images, then export in the file-list order. Corrections re-encode to PNG at up to 4 megapixels; originals stay unchanged.</p><label>Take a photo<input type="file" accept="image/jpeg,image/png" capture="environment" data-camera aria-label="Take a photo"></label><label>Photo to correct<select data-photo aria-label="Photo to correct"></select></label><div class="scan-control-grid">${scanControls()}</div><details><summary>Crop & perspective corners (%)</summary><p>Enter corners in the original photo, clockwise from top left. Straighten a photographed document by matching its four corners. Full-frame defaults keep the whole image.</p><div class="scan-corners">${['Top left', 'Top right', 'Bottom right', 'Bottom left'].map((name, i) => `<fieldset><legend>${name}</legend><label>X (%)<input type="number" min="0" max="100" step="0.1" data-corner="${i}x" value="${i === 1 || i === 2 ? 100 : 0}"></label><label>Y (%)<input type="number" min="0" max="100" step="0.1" data-corner="${i}y" value="${i > 1 ? 100 : 0}"></label></fieldset>`).join('')}</div></details><button type="button" class="secondary" data-review>Review & apply correction</button><button type="button" class="secondary" data-reset>Reset this photo</button><p data-scan-status role="status">Export uses original images until you apply a correction.</p><div data-scan-preview class="scan-review-pair"></div></details>`;
  const select = host.querySelector<HTMLSelectElement>('[data-photo]')!, status = host.querySelector<HTMLElement>('[data-scan-status]')!, preview = host.querySelector<HTMLElement>('[data-scan-preview]')!;
  const clear = (): void => { urls.forEach(url => URL.revokeObjectURL(url)); urls = []; preview.replaceChildren(); };
  const load = (): void => {
    generation++; controller?.abort(); clear();
    const file = files()[Number(select.value)], value = file && saved.get(file);
    const options = value?.options ?? defaultScanOptions, corners = value?.corners ?? fullCorners();
    for (const [key, v] of Object.entries(options)) (host.querySelector(`[name="${key}"]`) as HTMLInputElement).value = String(v);
    corners.forEach((p, i) => { for (const axis of ['x', 'y'] as const) host.querySelector<HTMLInputElement>(`[data-corner="${i}${axis}"]`)!.value = String(p[axis]); });
    status.textContent = value ? 'A reviewed correction is applied to this photo. Review again to apply changed settings.' : 'Export uses this original image until you apply a correction.';
  };
  const refresh = (): void => {
    const selected = files()[Number(select.value)];
    const live = files(); for (const key of saved.keys()) if (!live.includes(key)) saved.delete(key);
    select.replaceChildren(...live.map((f, i) => { const option = document.createElement('option'); option.value = String(i); option.textContent = `${i + 1}. ${f.name}`; return option; }));
    select.value = String(Math.max(0, selected ? live.indexOf(selected) : 0)); load();
  };
  select.addEventListener('change', load);
  host.querySelector<HTMLInputElement>('[data-camera]')!.addEventListener('change', event => { const input = event.target as HTMLInputElement; if (input.files) added([...input.files]); input.value = ''; });
  host.querySelector('[data-reset]')!.addEventListener('click', () => { const file = files()[Number(select.value)]; if (file) saved.delete(file); load(); });
  const process = async (file: File, settings: Settings, signal: AbortSignal) => {
    const original = await imageCanvas(file); let cropped: HTMLCanvasElement | undefined;
    try {
      const corners = settings.corners.map(p => ({ x: p.x * original.width / 100, y: p.y * original.height / 100 }));
      cropped = await cropPerspective(original, corners, signal);
      signal.throwIfAborted(); const corrected = correctedCanvas(cropped, settings.options).canvas;
      return { original, corrected };
    } catch (error) { original.width = original.height = 1; throw error; }
    finally { if (cropped) cropped.width = cropped.height = 1; }
  };
  host.querySelector('[data-review]')!.addEventListener('click', () => {
    const file = files()[Number(select.value)]; if (!file) { status.textContent = 'Choose a photo first.'; return; }
    controller?.abort(); const pending = controller = new AbortController(), current = ++generation;
    void (async () => {
      const options = scanOptions(Object.fromEntries(['rotation', 'deskew', 'cleanup'].map(key => [key, (host.querySelector(`[name="${key}"]`) as HTMLInputElement).value])));
      const corners = fullCorners().map((_, i) => ({ x: Number(host.querySelector<HTMLInputElement>(`[data-corner="${i}x"]`)!.value), y: Number(host.querySelector<HTMLInputElement>(`[data-corner="${i}y"]`)!.value) }));
      if (corners.some(p => p.x < 0 || p.x > 100 || p.y < 0 || p.y > 100)) throw Error('Crop corners must be between 0% and 100%.');
      status.textContent = 'Preparing before / after review…';
      const { original, corrected } = await process(file, { options, corners }, pending.signal);
      try {
        const blobs = await Promise.all([canvasBlob(original), canvasBlob(corrected)]);
        if (disposed || current !== generation) return;
        clear(); blobs.forEach((blob, i) => { const figure = document.createElement('figure'), img = document.createElement('img'), caption = document.createElement('figcaption'); img.src = URL.createObjectURL(blob); urls.push(img.src); img.alt = i ? 'Corrected scan preview' : 'Original photo preview'; caption.textContent = i ? 'After · applied to export' : 'Before · original'; figure.append(img, caption); preview.append(figure); });
        saved.set(file, { options, corners }); status.textContent = 'Correction applied. Review the before / after images. Change settings and review again to replace it.';
      } finally { original.width = original.height = corrected.width = corrected.height = 1; }
    })().catch((error: unknown) => { if (!disposed && current === generation) status.textContent = error instanceof Error ? error.message : 'Could not correct this photo.'; });
  });
  return {
    refresh,
    async inputs(signal: AbortSignal, progress: (done: number, total: number) => void): Promise<File[]> {
      const result: File[] = [], input = files().slice();
      if (controller && !controller.signal.aborted && status.textContent === 'Preparing before / after review…') throw Error('Wait for the photo review to finish before exporting.');
      for (const [i, file] of input.entries()) {
        signal.throwIfAborted(); const settings = saved.get(file);
        if (settings) { const { original, corrected } = await process(file, settings, signal); try { result.push(new File([await canvasBlob(corrected)], file.name.replace(/\.[^.]+$/, '') + '-corrected.png', { type: 'image/png' })); } finally { original.width = original.height = corrected.width = corrected.height = 1; } }
        else result.push(file);
        progress(i + 1, input.length);
      }
      return result;
    },
    dispose() { disposed = true; generation++; controller?.abort(); saved.clear(); clear(); }
  };
}
