import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const packageInfo = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const commit = process.env.GITHUB_SHA || (() => {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { return 'local'; }
})();

export default defineConfig({
  plugins: [{ name: 'docflow-release-identity', generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'release.json', source: JSON.stringify({ format: 'docflow-release', schema: 1, version: packageInfo.version, build: commit }) });
  } }],
  define: {
    __DOCFLOW_VERSION__: JSON.stringify(packageInfo.version),
    __DOCFLOW_BUILD__: JSON.stringify(commit)
  },
  base: '/zubaer-ahmed-PDF-TEST/',
  worker: {format:'es'},
  build: {
    target: 'es2022',
    sourcemap: true,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('pdfjs-dist')) return 'pdfjs';
          if (id.includes('pdf-lib')) return 'pdf-lib';
          if (id.includes('jszip')) return 'jszip';
        }
      }
    }
  }
});
