import { defineConfig, devices } from '@playwright/test';

/**
 * Agent-first Export PDF audit against the **desktop** renderer (same print CSS /
 * #print-flow path Electron printToPDF uses). Does not require a human Export click.
 *
 * Run: npm run test:pdf-audit
 */
const PORT = 4174;
const HOST = '127.0.0.1';
const baseURL = `http://${HOST}:${PORT}`;

export default defineConfig({
  testDir: './e2e/pdf-audit',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report-pdf-audit' }],
  ],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'en-US',
    viewport: { width: 1400, height: 900 },
  },
  webServer: {
    command: `npm run build:desktop && npm run preview -w markdown2pdf-desktop -- --host ${HOST} --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'desktop-chromium-pdf',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
