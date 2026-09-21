import { test, expect } from '@playwright/test';
import { webkit } from 'playwright';
import { fixture } from './helpers.mjs';

// tiff-to-*.html tells the user that Safari decodes TIFF natively while Chrome,
// Edge and Firefox do not. playwright.config.mjs runs Chromium only, so the
// half of that claim which promises SUCCESS was never exercised: only the
// failure path had a test.
//
// This verifies the CLAIM, not our code. Measured: it still passes with the
// TIFF branch deleted from convertWithCanvas, because WebKit decodes TIFF at
// the first createImageBitmap call and never reaches the fallback. So the
// loadNativeImage(file, TIFF_DECODE_ERROR) branch exists only to produce the
// TIFF-specific message on Chromium, which the Chromium test already covers.
//
// Measured 2026-09-20 against the deployed site: WebKit produced a download,
// Chromium showed "Could not decode TIFF ... Try Safari or another
// TIFF-capable app." Exactly what the copy says.
//
// WebKit is launched directly rather than as a second project, so the default
// suite keeps its single-browser cost and this degrades to a skip on a machine
// without `npx playwright install webkit`.
test('Safari really does decode TIFF, as the page copy promises', async ({ baseURL }) => {
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

    // The whole point of the claim: on WebKit this converts instead of showing
    // the TIFF guidance that Chromium gets.
    await expect(page.locator('.btn-download').first()).toBeVisible({ timeout: 30_000 });
    const body = await page.locator('#file-list').innerText();
    expect(body).not.toMatch(/Could not decode TIFF/i);
  } finally {
    await browser.close();
  }
});
