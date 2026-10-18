import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.DOCFLOW_PRODUCTION_BASE_URL;
if (!baseURL) throw new Error('DOCFLOW_PRODUCTION_BASE_URL is required for production verification.');

export default defineConfig({
  testDir: './e2e',
  // Reuse the same export/reopen assertions against the built deployment.
  // Keep expensive stress tests in the full pre-deployment browser matrix.
  testMatch: [
    'r7-product-finish.spec.ts',
    'r6-workflows-exports.spec.ts', 'r5-release.spec.ts', 'r4-document-quality.spec.ts', 'r3-mobile-offline.spec.ts', 'r2-editing-reading.spec.ts', 'production.spec.ts', 'r0-baseline.spec.ts', 'document-session.spec.ts',
    'forms-matrix.spec.ts', 'color-fidelity.spec.ts',
    'phase3-ocr-comparison.spec.ts', 'workflow-builder.spec.ts',
    'professional-redaction-repair.spec.ts', 'release.spec.ts', 'organize-workspace.spec.ts', 'essential-utilities.spec.ts',
    'image-watermark.spec.ts', 'professional-compression.spec.ts', 'extract-images.spec.ts',
    'batch-workspace.spec.ts', 'encryption.spec.ts'
  ],
  workers: 2,
  timeout: 120_000,
  expect: { timeout: 12_000 },
  retries: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ]
});
