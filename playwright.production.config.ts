import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.DOCFLOW_PRODUCTION_BASE_URL;
if (!baseURL) throw new Error('DOCFLOW_PRODUCTION_BASE_URL is required for production verification.');

export default defineConfig({
  testDir: './e2e',
  testMatch: 'v2-*.spec.ts',
  // Local build fault injection, stress runs and mocked accounts stay in CI.
  testIgnore: [
    '**/v2-cloud-sync.spec.ts', '**/v2-input-budget.spec.ts', '**/v2-long-document.spec.ts',
    '**/v2-offline.spec.ts', '**/v2-resource-lifecycle.spec.ts', '**/v2-server-processing.spec.ts',
    '**/v2-update-recovery.spec.ts', '**/v2-visual-review.spec.ts',
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
    { name: 'chromium', use: {
      ...devices['Desktop Chrome'],
      launchOptions: process.env.DOCFLOW_TEST_CHROMIUM
        ? { executablePath: process.env.DOCFLOW_TEST_CHROMIUM }
        : undefined
    } }
  ]
});
