import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

test.describe('Resize settings validation', () => {
  test('0% scale is rejected instead of silently becoming 100%', async ({ page }) => {
    await page.goto('/resize-image');
    await page.locator('#file-input').setInputFiles(fixture('odd-dimensions.png'));
    await page.locator('.file-item').waitFor({ timeout: 5000 });

    await page.locator('#resize-mode').selectOption('percent');
    await page.locator('#resize-percent').fill('0');
    await page.locator('#resize-btn').click();

    await expect(page.locator('#resize-settings-notice')).toContainText('1% to 1000%');
    await expect(page.locator('#resize-percent')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('.file-item__status')).toHaveText('Ready');
    await expect(page.locator('.btn-download')).toHaveCount(0);
  });

  test('valid scale still resizes after correcting an invalid value', async ({ page }) => {
    await page.goto('/resize-image');
    await page.locator('#file-input').setInputFiles(fixture('odd-dimensions.png'));
    await page.locator('.file-item').waitFor({ timeout: 5000 });

    await page.locator('#resize-mode').selectOption('percent');
    await page.locator('#resize-percent').fill('0');
    await page.locator('#resize-btn').click();
    await expect(page.locator('#resize-settings-notice')).toBeVisible();

    await page.locator('#resize-percent').fill('50');
    await page.locator('#resize-btn').click();

    await expect(page.locator('#resize-settings-notice')).toBeHidden();
    await page.locator('.file-item.done').waitFor({ timeout: 10000 });
    await expect(page.locator('.btn-download')).toBeVisible();
  });

  // A processing error is recoverable, unlike a validation error at add time, so
  // the entry stays retryable. The Resize button used to disappear anyway, which
  // left no way to act on the correction.
  test('an oversized-dimension error still leaves Resize available to retry', async ({ page }) => {
    await page.goto('/resize-image');
    await page.locator('#file-input').setInputFiles(fixture('landscape.png'));
    await expect(page.locator('.file-item').first()).toBeVisible({ timeout: 15000 });

    await page.locator('#lock-aspect').uncheck();
    await page.locator('#resize-width').fill('16384');
    await page.locator('#resize-height').fill('16384');
    await page.locator('#resize-btn').click();

    await expect(page.locator('.file-item__status.error')).toContainText(/too large/i, { timeout: 30000 });
    await expect(page.locator('#resize-btn')).toBeVisible();

    await page.locator('#resize-width').fill('320');
    await page.locator('#resize-height').fill('240');
    await page.locator('#resize-btn').click();
    await expect(page.locator('.file-item.done').first()).toBeVisible({ timeout: 30000 });
  });
});
