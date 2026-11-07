export function outputFilename(value: string, original: string): string {
  const extension = original.match(/\.[a-z0-9]{1,8}$/i)?.[0] ?? '';
  const clean = [...value].map(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || /[<>:"/\\|?*]/.test(character) ? '-' : character).join('').trim().replace(/^\.+|[. ]+$/g, '');
  const base = extension && clean.toLowerCase().endsWith(extension.toLowerCase()) ? clean.slice(0, -extension.length) : clean;
  return (base.slice(0, 100) || 'document') + extension;
}
