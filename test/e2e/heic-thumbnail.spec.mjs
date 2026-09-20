import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

test.describe('source thumbnail fallback', () => {
  test('HEIC input never leaves a broken blank thumbnail', async ({ page }) => {
    await page.goto('/heic-to-jpg');
    await page.locator('#file-input').setInputFiles(fixture('sample.heic'));

    const previewState = async () => {
      const fallback = page.locator('.file-item__thumb-fallback');
      if (await fallback.count()) return 'fallback';

      const img = page.locator('.file-item__thumb img');
      if (!(await img.count())) return 'pending';
      return img.evaluate((node) => {
        if (!node.complete) return 'pending';
        return node.naturalWidth > 0 ? 'native' : 'broken';
      });
    };

    await expect.poll(previewState).not.toBe('pending');
    await expect.poll(previewState).not.toBe('broken');

    if (await page.locator('.file-item__thumb-fallback').count()) {
      await expect(page.locator('.file-item__thumb-fallback .route-thumb-tile__ext'))
        .toHaveText('HEIC');
    }
  });
});
