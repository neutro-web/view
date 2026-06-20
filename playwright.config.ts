import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/browser',
  testMatch: '**/*.spec.ts',
  // Chromium only to pass. WebKit/Firefox: near-term tripwire — add as additional projects entries.
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  use: {
    headless: true,
    // --headed --debug flag: npx playwright test --headed --debug
  },
  globalSetup: './test/browser/global-setup.ts',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test/browser/playwright-report' }]],
  outputDir: 'test/browser/test-results',
})
