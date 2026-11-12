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

/** Normalize every generated download, including the original-name pass-through tools.
 * A PDF called `invoice.exe` must still download as a PDF, and two exported
 * names that normalize to the same filename must never overwrite one another.
 */
const exportExtensions: Readonly<Record<string,string>> = {
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'application/json': '.json',
  'text/plain': '.txt',
  'text/html': '.html',
  'text/markdown': '.md',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/tiff': '.tiff'
};

export function safeResultFilenames(outputs: readonly {name:string;type:string}[]):string[]{
  const normalized=outputs.map(output=>{
    const mime=output.type.split(';',1)[0]!.trim().toLowerCase();
    const expected=exportExtensions[mime];
    // For known MIME types, the actual output type determines the extension.
    const label=expected?output.name.replace(/\.[a-z0-9]{1,8}$/i,''):output.name;
    return outputFilename(label,expected?'result'+expected:output.name);
  });
  const reserved=new Set(normalized.map(name=>name.toLowerCase()));
  const used=new Set<string>();
  return normalized.map(name=>{
    const key=name.toLowerCase();
    if(!used.has(key)){used.add(key);return name;}
    const extension=name.match(/\.[a-z0-9]{1,8}$/i)?.[0]??'';
    const stem=extension?name.slice(0,-extension.length):name;
    let n=2, candidate:string;
    do{candidate=stem+'-'+n+++extension;}while(used.has(candidate.toLowerCase())||reserved.has(candidate.toLowerCase()));
    used.add(candidate.toLowerCase());
    return candidate;
  });
}
