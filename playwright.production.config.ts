import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.DOCFLOW_PRODUCTION_BASE_URL;
if (!baseURL) throw new Error('DOCFLOW_PRODUCTION_BASE_URL is required for production verification.');

export default defineConfig({
  testDir: './e2e',
  testMatch: 'production.spec.ts',
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
