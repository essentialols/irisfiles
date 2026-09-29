import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { fixture, expectDownloadOnClick, buildApng } from './helpers.mjs';

// Resize a file to 50% and return what the download actually contains.
async function resizeHalfAndDownload(page, file) {
  await page.goto('/resize-image');
  await page.locator('#file-input').setInputFiles(file);
  await page.locator('.file-item').waitFor();
  await page.locator('#resize-mode').selectOption('percent');
  await page.locator('#resize-percent').fill('50');
  await page.locator('#resize-btn').click();
  const download = await expectDownloadOnClick(page, '.btn-download');
  const bytes = await readFile(await download.path());
  return { name: download.suggestedFilename(), magic: bytes.toString('latin1', 0, 4), riffType: bytes.toString('latin1', 8, 12) };
}

test.describe('Resize keeps a transparency-capable output format', () => {
  test('WebP resizes to WebP, not JPEG', async ({ page }) => {
    const out = await resizeHalfAndDownload(page, fixture('sample.webp'));
    expect(out).toMatchObject({ name: 'sample-50pct.webp', magic: 'RIFF', riffType: 'WEBP' });
  });

  test('a still GIF resizes to PNG, not JPEG', async ({ page }) => {
    const out = await resizeHalfAndDownload(page, fixture('sample.gif'));
    expect(out.name).toBe('sample-50pct.png');
    expect(out.magic).toBe('\x89PNG');
  });

  // Safari cannot encode WebP: toBlob hands back PNG for the request. Simulate
  // that so the file is named for its real contents, not for what was asked.
  test('a browser that cannot encode WebP gets a PNG named .png', async ({ page }) => {
    await page.addInitScript(() => {
      const toBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (cb, type, q) {
        return toBlob.call(this, cb, type === 'image/webp' ? 'image/png' : type, q);
      };
    });
    const out = await resizeHalfAndDownload(page, fixture('sample.webp'));
    expect(out.name).toBe('sample-50pct.png');
    expect(out.magic).toBe('\x89PNG');
  });
});

test.describe('Resize refuses animated images', () => {
  // Canvas keeps only the first frame, so on main each of these "succeeds" and
  // downloads a still.
  test('animated GIF, WebP and APNG are refused instead of flattened', async ({ page }) => {
    await page.goto('/resize-image');
    await page.locator('#file-input').setInputFiles([
      { name: 'animated.gif', mimeType: 'image/gif', buffer: await readFile(fixture('animated.gif')) },
      { name: 'animated.webp', mimeType: 'image/webp', buffer: await readFile(fixture('animated.webp')) },
      { name: 'animated.png', mimeType: 'image/png', buffer: await buildApng() },
    ]);
    await expect(page.locator('.file-item')).toHaveCount(3);
    await page.locator('#resize-mode').selectOption('percent');
    await page.locator('#resize-percent').fill('50');
    await page.locator('#resize-btn').click();

    const status = page.locator('.file-item__status');
    await expect(status.nth(0)).toContainText('Animated GIF cannot be resized');
    await expect(status.nth(1)).toContainText('Animated WebP cannot be resized');
    await expect(status.nth(2)).toContainText('Animated PNG (APNG) cannot be resized');
    await expect(page.locator('.btn-download')).toHaveCount(0);
  });
});

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
