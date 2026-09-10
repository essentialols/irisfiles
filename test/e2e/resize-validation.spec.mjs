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
});
