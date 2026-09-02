import { defineConfig } from 'vite';

export default defineConfig({
  base: '/zubaer-ahmed-PDF-TEST/',
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
