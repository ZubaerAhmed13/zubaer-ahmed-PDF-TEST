import type { ToolDefinition } from './registry';
import { mountWorkspace as mountRecoveredWorkspace } from './workspaceWithRecovery';

interface Preset { quality: string; maxDimension: string }
const presets: Record<string, Preset> = {
  light: { quality: '0.88', maxDimension: '3200' },
  balanced: { quality: '0.78', maxDimension: '2200' },
  strong: { quality: '0.65', maxDimension: '1400' }
};

export function mountWorkspace(container: HTMLDivElement, tool: ToolDefinition): void {
  mountRecoveredWorkspace(container, tool);
  const form = container.querySelector<HTMLFormElement>('#tool-options');
  if (!form) return;

  form.innerHTML = `
    <div class="notice">
      <strong>Selective JPEG image recompression</strong>
      <p>DocFlow keeps PDF pages, text, vectors and forms structural. Only simple 8-bit DeviceRGB JPEG image XObjects are eligible. Images with masks, ICC/CMYK/complex decode settings or unsupported filters are left untouched.</p>
    </div>
    <label>Compression mode
      <select name="compressionPreset">
        <option value="light">Light — prioritize quality</option>
        <option value="balanced" selected>Balanced — recommended</option>
        <option value="strong">Strong — higher size reduction</option>
        <option value="custom">Custom</option>
      </select>
    </label>
    <label>JPEG quality
      <input name="imageQuality" type="number" min="0.50" max="0.95" step="0.01" value="0.78" inputmode="decimal">
    </label>
    <label>Maximum image dimension (px)
      <input name="maxImageDimension" type="number" min="900" max="5000" step="100" value="2200" inputmode="numeric">
    </label>
    <p class="help">Light uses JPEG quality 0.88 / 3200 px, Balanced 0.78 / 2200 px, and Strong 0.65 / 1400 px. Custom keeps your advanced values. Images are replaced only when the new JPEG is at least 2% smaller. Downsampling occurs only above the selected dimension. This operation is potentially lossy for eligible JPEG images but does not intentionally rasterize whole PDF pages.</p>
  `;

  const preset = form.elements.namedItem('compressionPreset');
  const quality = form.elements.namedItem('imageQuality');
  const dimension = form.elements.namedItem('maxImageDimension');
  if (!(preset instanceof HTMLSelectElement) || !(quality instanceof HTMLInputElement) || !(dimension instanceof HTMLInputElement)) return;

  const applyPreset = (): void => {
    const selected = presets[preset.value];
    if (!selected) return;
    quality.value = selected.quality;
    dimension.value = selected.maxDimension;
    quality.dispatchEvent(new Event('input', { bubbles: true }));
    dimension.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const markCustom = (): void => { if (preset.value !== 'custom') preset.value = 'custom'; };

  preset.addEventListener('change', applyPreset);
  quality.addEventListener('input', markCustom);
  dimension.addEventListener('input', markCustom);

  container.addEventListener('docflow-cleanup', () => {
    preset.removeEventListener('change', applyPreset);
    quality.removeEventListener('input', markCustom);
    dimension.removeEventListener('input', markCustom);
  }, { once: true });
}
