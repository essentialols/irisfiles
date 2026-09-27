import { test, expect } from '@playwright/test';
import { webkit } from 'playwright';
import { fixture } from './helpers.mjs';

// Chromium exercises the vendored TIFF fallback elsewhere. This separately
// protects the fast path: WebKit/Safari can decode TIFF natively, so the local
// decoder should remain unnecessary there.
test('WebKit keeps using its native TIFF decoder without loading the fallback', async ({ baseURL }) => {
  test.slow();
  let browser;
  try { browser = await webkit.launch(); }
  catch { test.skip(true, 'WebKit is not installed; run npx playwright install webkit'); return; }
  try {
    const page = await browser.newPage();
    let fallbackRequested = false;
    await page.route('**/js/utif.js', route => { fallbackRequested = true; return route.abort(); });
    await page.goto(baseURL + '/tiff-to-jpg');
    await page.locator('#file-input').setInputFiles(fixture('sample.tiff'));
    await page.locator('.file-item.done, .file-item.error').first().waitFor({ timeout: 60_000 });
    await expect(page.locator('.btn-download').first()).toBeVisible({ timeout: 30_000 });
    expect(fallbackRequested).toBe(false);
  } finally { await browser.close(); }
});
