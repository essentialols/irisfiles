import { defineConfig } from '@playwright/test';

// Port and server reuse are configurable so two checkouts can be tested at
// once. Reusing a server across directories silently serves the wrong code:
// a gate that runs in a worktree would then be grading the main checkout.
const PORT = Number(process.env.IRIS_TEST_PORT || 3988);
const REUSE = process.env.IRIS_TEST_NO_REUSE !== '1';
// Measured on the 12-core M2 this repo is developed on: the same 1001 tests took
// 13.6m at 1 worker and 6.9m at 4, and the serial runs were the ones that flaked
// (two timeout failures each, different tests) while the parallel run was clean.
// Most of a test here is waiting on a CDN fetch or FFmpeg.wasm, so overlapping
// the waits costs little CPU. Drop to 1 if a machine cannot take it.
const WORKERS = Number(process.env.IRIS_TEST_WORKERS || 4);
// Retrying a failure costs a second full timeout. The patrol gate compares
// failure sets rather than chasing flakes, so it turns retries off.
const RETRIES = Number(process.env.IRIS_TEST_RETRIES ?? 1);
// Point the suite at a real deployment instead of a local server:
//   IRIS_TEST_BASE_URL=https://irisfiles.com npx playwright test
// This is what catches anything that only exists once deployed, such as a test
// depending on a path .vercelignore excludes, or a CDN header overriding
// vercel.json. A test must therefore build its input in-page or load it from
// test/fixtures, never fetch a fixture over HTTP: that directory is not deployed.
const BASE_URL = process.env.IRIS_TEST_BASE_URL;
// Specs tagged @evidence produce artifacts for the privacy guide rather than
// guarding a behaviour, and one of them spends a minute doing two full FFmpeg
// conversions. They are not part of the gate; opt in with IRIS_TEST_EVIDENCE=1.
const EVIDENCE = process.env.IRIS_TEST_EVIDENCE === '1';

export default defineConfig({
  testDir: './test/e2e',
  timeout: 60_000,
  retries: RETRIES,
  workers: WORKERS,
  ...(EVIDENCE ? {} : { grepInvert: /@evidence/ }),
  use: {
    baseURL: BASE_URL || `http://localhost:${PORT}`,
    headless: true,
    screenshot: 'only-on-failure',
  },
  // No local server when testing a deployment; it would serve the wrong code.
  ...(BASE_URL ? {} : {
    webServer: {
      command: `npx serve . -p ${PORT}`,
      port: PORT,
      reuseExistingServer: REUSE,
      timeout: 15_000,
    },
  }),
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
