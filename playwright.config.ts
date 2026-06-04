import { defineConfig } from '@playwright/test';

// Playwright E2E configuration.
//
// The "setup" project authenticates once via the test-login backdoor and saves
// the session cookie as storageState. The "e2e" project reuses that saved
// state so every test starts already logged in — no per-test login overhead.
//
// Requirements in .env:
//   TEST_LOGIN_ENABLED=true
//   TEST_LOGIN_TOKEN=e2e-test-token
//
// Bun loads .env natively; no dotenv dependency needed.

export default defineConfig({
  testDir: './client/e2e',
  testMatch: /\.spec\.ts$/,
  outputDir: 'test-results',

  workers: 1,
  retries: process.env.CI ? 2 : 1,
  timeout: 60_000,

  expect: { timeout: 10_000 },

  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],

  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:5173',

    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'e2e',
      testDir: './client/e2e',
      testMatch: /\.spec\.ts$/,
      dependencies: ['setup'],
    },
  ],
});
