/** Keep the extension selected by the PDF tool and make user-defined names safe to export.
 * Preserve ordinary Unicode (including emoji and joined scripts), but replace
 * path separators, invisible direction overrides and filename control codes.
 */
const unsafeFilenameCharacters = /[\p{Cc}\u061c\u200b\u200e\u200f\u2028-\u202e\u2060\u2066-\u2069\ufeff<>:"/\\|?*]/gu;
const windowsDeviceName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function outputFilename(value: string, original: string): string {
  const extension = original.match(/\.[a-z0-9]{1,8}$/i)?.[0] ?? '';
  const clean = value.normalize('NFC').replace(unsafeFilenameCharacters, '-')
    .trim().replace(/^\.+|[. ]+$/g, '');
  const withoutExtension = extension && clean.toLowerCase().endsWith(extension.toLowerCase())
    ? clean.slice(0, -extension.length) : clean;
  // Removing an existing extension may reveal a trailing dot or space.
  const base = Array.from(withoutExtension.replace(/[. ]+$/g, '') || 'document')
    .slice(0, 100).join('');
  return (windowsDeviceName.test(base) ? '_' : '') + base + extension;
}
