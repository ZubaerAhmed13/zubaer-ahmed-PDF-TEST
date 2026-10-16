import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.DOCFLOW_PRODUCTION_BASE_URL;
if (!baseURL) throw new Error('DOCFLOW_PRODUCTION_BASE_URL is required for production verification.');

export default defineConfig({
  testDir: './e2e',
  // Reuse the same export/reopen assertions against the built deployment.
  // Keep expensive stress tests in the full pre-deployment browser matrix.
  testMatch: [
    'production.spec.ts', 'r0-baseline.spec.ts', 'document-session.spec.ts',
    'forms-matrix.spec.ts', 'color-fidelity.spec.ts',
    'phase3-ocr-comparison.spec.ts', 'workflow-builder.spec.ts',
    'professional-redaction-repair.spec.ts'
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
