import { gunzipSync } from 'node:zlib';
import { copyFile, mkdir, readdir, rm, stat, readFile, writeFile } from 'node:fs/promises';
import { join, basename, resolve } from 'node:path';

const root = resolve('.');
const output = join(root, 'public', 'ocr');
const modules = join(root, 'node_modules');

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await files(path));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}
async function copyRequired(src, to) {
  if (!(await stat(src).catch(() => null))?.isFile()) throw new Error('Missing installed OCR asset: ' + src);
  await mkdir(join(output, to), { recursive: true });
  await copyFile(src, join(output, to, basename(src)));
}
await rm(output, { force: true, recursive: true });
await mkdir(join(output, 'core'), { recursive: true });
await mkdir(join(output, 'lang'), { recursive: true });
await copyRequired(join(modules, 'tesseract.js', 'dist', 'worker.min.js'), '.');
const coreFiles = (await files(join(modules, 'tesseract.js-core'))).filter(p => /tesseract-core.*\.(?:wasm|js)$/.test(basename(p)));
if (coreFiles.length < 8) throw Error('Missing expected OCR WebAssembly core variants.');
for (const source of coreFiles) await copyRequired(source, 'core');
for (const language of ['eng', 'deu']) {
  const sources = await files(join(modules, '@tesseract.js-data', language));
  const gz = sources.find(p => basename(p) === language + '.traineddata.gz');
  if (!gz) throw Error('Missing packaged offline OCR language model: ' + language);
  // Plain model paths avoid hosts that serve .gz as HTTP Content-Encoding and decode it implicitly.
  await writeFile(join(output, 'lang', language + '.traineddata'), gunzipSync(await readFile(gz)));
}
console.log('Staged same-origin OCR worker, WebAssembly core and two language models.');
