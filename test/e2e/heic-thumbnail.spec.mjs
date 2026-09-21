import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

// Both of these pages render a source thumbnail from their own UI module, and
// each reaches the fallback through a different boot file. /resize-image showed
// a broken <img> for months because only boot.js installed it.
const THUMBNAIL_PAGES = ['/heic-to-jpg', '/resize-image'];

for (const path of THUMBNAIL_PAGES) {
  test.describe(`source thumbnail fallback on ${path}`, () => {
    test('HEIC input never leaves a broken blank thumbnail', async ({ page }) => {
      await page.goto(path);
      await page.locator('#file-input').setInputFiles(fixture('sample.heic'));

      // Wait for the row itself first. Polling previewState alone would sit on
      // 'pending' until the timeout and report a wait, not the real state.
      await page.locator('.file-item').first().waitFor({ timeout: 20_000 });

      const previewState = async () => {
        if (await page.locator('.file-item__thumb-fallback').count()) return 'fallback';

        const img = page.locator('.file-item__thumb img');
        if (!(await img.count())) return 'no-thumb';
        return img.first().evaluate((node) => {
          if (!node.complete) return 'pending';
          if (node.naturalWidth > 0) return 'native';
          return node.style.display === 'none' ? 'hidden-broken' : 'broken';
        });
      };

      await expect.poll(previewState, { timeout: 20_000 }).not.toBe('pending');
      // 'broken' is the defect: a failed decode still on screen as a blank box.
      expect(['fallback', 'native', 'no-thumb']).toContain(await previewState());

      if (await page.locator('.file-item__thumb-fallback').count()) {
        await expect(page.locator('.file-item__thumb-fallback .route-thumb-tile__ext').first())
          .toHaveText('HEIC');
      }
    });
  });
}
