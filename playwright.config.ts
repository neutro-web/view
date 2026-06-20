import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/browser',
  testMatch: '**/*.spec.ts',
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
  ],
  use: {
    headless: true,
    // --headed --debug flag: npx playwright test --headed --debug
  },
  globalSetup: './test/browser/global-setup.ts',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test/browser/playwright-report' }]],
  outputDir: 'test/browser/test-results',
})
