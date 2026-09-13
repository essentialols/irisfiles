import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

test.use({ viewport: { width: 390, height: 844 } });

test('delete mode keeps its page status badge on mobile', async ({ page }) => {
  await page.goto('/delete-pdf-pages');
  await page.locator('#file-input').setInputFiles(fixture('multi-page.pdf'));
  await expect(page.locator('.pdf-page-card').first()).toBeVisible({ timeout: 30000 });
  const badge = page.locator('.pdf-page-card__badge').first();
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText(/Keep|Will delete/);
});

test('reorder mode still hides its redundant badge on mobile', async ({ page }) => {
  await page.goto('/reorder-pdf-pages');
  await page.locator('#file-input').setInputFiles(fixture('multi-page.pdf'));
  await expect(page.locator('.pdf-page-card').first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.pdf-page-card__badge').first()).toBeHidden();
});
