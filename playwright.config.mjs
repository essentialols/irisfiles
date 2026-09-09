import { defineConfig } from '@playwright/test';

// Port and server reuse are configurable so two checkouts can be tested at
// once. Reusing a server across directories silently serves the wrong code:
// a gate that runs in a worktree would then be grading the main checkout.
const PORT = Number(process.env.IRIS_TEST_PORT || 3988);
const REUSE = process.env.IRIS_TEST_NO_REUSE !== '1';
const WORKERS = Number(process.env.IRIS_TEST_WORKERS || 1);
// Retrying a failure costs a second full timeout. The patrol gate compares
// failure sets rather than chasing flakes, so it turns retries off.
const RETRIES = Number(process.env.IRIS_TEST_RETRIES ?? 1);

export default defineConfig({
  testDir: './test/e2e',
  timeout: 60_000,
  retries: RETRIES,
  workers: WORKERS,
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npx serve . -p ${PORT}`,
    port: PORT,
    reuseExistingServer: REUSE,
    timeout: 15_000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
