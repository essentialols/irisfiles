import { test, expect } from '@playwright/test';
import { webkit } from 'playwright';
import { fixture } from './helpers.mjs';

// Safari decodes TIFF natively, so it never needs js/tiff-decoder.js, the local
// fallback Chromium and Firefox use. playwright.config.mjs runs Chromium only, so
// without this the native half of the TIFF pages was never exercised.
//
// This verifies the browser's capability, not our code: it still passes with the
// fallback deleted, because WebKit decodes TIFF at the first createImageBitmap
// call and never reaches it. The Chromium tests in image-formats-all cover the
// fallback itself.
//
// WebKit is launched directly rather than as a second project, so the default
// suite keeps its single-browser cost and this degrades to a skip on a machine
// without `npx playwright install webkit`.
test('Safari decodes TIFF natively', async ({ baseURL }) => {
  test.slow();

  let browser;
  try {
    browser = await webkit.launch();
  } catch {
    test.skip(true, 'WebKit is not installed: run `npx playwright install webkit`');
    return;
  }

  try {
    const page = await browser.newPage();
    await page.goto(`${baseURL}/tiff-to-jpg`);
    await page.locator('#file-input').setInputFiles(fixture('sample.tiff'));

    await page.locator('.file-item.done, .file-item.error').first()
      .waitFor({ timeout: 60_000 });

    // On WebKit this converts natively.
    await expect(page.locator('.btn-download').first()).toBeVisible({ timeout: 30_000 });
    const body = await page.locator('#file-list').innerText();
    expect(body).not.toMatch(/Could not decode TIFF/i);
  } finally {
    await browser.close();
  }
});
