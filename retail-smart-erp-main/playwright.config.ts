import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.TEST_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'setup',
      testMatch: /global-setup\.ts/,
      teardown: 'teardown',
    },
    {
      name: 'teardown',
      testMatch: /global-teardown\.ts/,
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      testIgnore: /workflows\//,
    },
    {
      name: 'workflows',
      testDir: './e2e/tests/workflows',
      testMatch: /\d{2}-.*\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
      timeout: 180_000,
    },
    {
      name: 'ui-workflows',
      testDir: './e2e/tests/ui-workflows',
      testMatch: /\d{2}-.*\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        actionTimeout: 20_000,
        navigationTimeout: 45_000,
      },
      timeout: 300_000,
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
