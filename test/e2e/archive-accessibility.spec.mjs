import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

test.describe('Archive action names', () => {
  test('extracted ZIP actions identify the file they download', async ({ page }) => {
    await page.goto('/extract-zip');
    await page.locator('#file-input').setInputFiles(fixture('nested.zip'));

    await expect(page.getByRole('button', { name: 'Remove nested.zip', exact: true })).toBeVisible();
    await page.locator('#action-btn').click();
    await page.locator('#archive-results').waitFor({ timeout: 10000 });

    await expect(page.getByRole('button', { name: 'Download top.txt', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download dir/inner.txt', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download dir/sub/deep.txt', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download', exact: true })).toHaveCount(0);
  });

  test('create ZIP actions identify their input and output files', async ({ page }) => {
    await page.goto('/create-zip');
    await page.locator('#file-input').setInputFiles([
      fixture('sample.png'),
      fixture('sample.jpg'),
    ]);

    await expect(page.getByRole('button', { name: 'Remove sample.png', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove sample.jpg', exact: true })).toBeVisible();

    await page.locator('#action-btn').click();
    await page.locator('#archive-results').waitFor({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Download archive.zip', exact: true })).toBeVisible();
  });
});
