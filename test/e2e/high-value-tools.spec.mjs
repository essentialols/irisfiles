import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

test.describe('High-value tool expansion', () => {
  test('landing exposes the new tool families', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('a[href="/mp4-to-mp3"]')).toBeVisible();
    await expect(page.locator('a[href="/image-to-text"]')).toBeVisible();
    await expect(page.locator('a[href="/png-to-ico"]')).toBeVisible();
    await expect(page.locator('a[href="/compress-pdf"]')).toBeVisible();
    await expect(page.locator('a[href="/html-to-pdf"]')).toBeVisible();
  });

  test('smart drop adds video-to-audio destinations without replacing existing routes', async ({ page }) => {
    await page.goto('/');
    await page.locator('#smart-file-input').setInputFiles(fixture('sample.mp4'));

    await expect(page.locator('.route-option[data-href="/mp4-to-mp3"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.route-option[data-href="/mp4-to-wav"]')).toBeVisible();
    await expect(page.locator('.route-option[data-href="/mp4-to-webm"]')).toBeVisible();
  });

  test('MP4 to MP3 converts a sample video', async ({ page }) => {
    await page.goto('/mp4-to-mp3');
    await page.locator('#file-input').setInputFiles(fixture('sample.mp4'));

    await expect(page.locator('.file-item.done')).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('.file-item.done .btn--success')).toBeVisible();
  });

  test('PNG to ICO creates a downloadable ICO', async ({ page }) => {
    await page.goto('/png-to-ico');
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));

    await expect(page.locator('.file-item.done')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.file-item.done .btn--success')).toBeVisible();
    await expect(page.locator('.file-item__meta')).toContainText('→');
  });

  test('image OCR page accepts a supported image without uploading it', async ({ page }) => {
    await page.goto('/image-to-text');
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));

    await expect(page.locator('#action-btn')).toBeVisible();
    await expect(page.locator('#ocr-lang')).toBeVisible();
    await expect(page.locator('.file-item__name')).toContainText('sample.png');
  });

  test('rotate PDF preserves the page workflow and produces a new PDF', async ({ page }) => {
    await page.goto('/rotate-pdf');
    await page.locator('#file-input').setInputFiles(fixture('sample.pdf'));

    const firstPage = page.locator('.pdf-page-card').first();
    await expect(firstPage).toBeVisible({ timeout: 15_000 });
    await firstPage.getByRole('button', { name: 'Rotate 90°' }).click();
    await expect(firstPage.locator('.pdf-page-card__badge')).toContainText('90°');

    await page.locator('#action-btn').click();
    await expect(page.locator('#pdf-tool-result .btn--success')).toBeVisible({ timeout: 15_000 });
  });

  test('PDF to text extracts embedded text', async ({ page }) => {
    await page.goto('/pdf-to-text');
    await page.locator('#file-input').setInputFiles(fixture('sample.pdf'));
    await page.locator('#action-btn').click();

    const output = page.locator('#pdf-text-result');
    await expect(output).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await output.inputValue()).trim().length).toBeGreaterThan(0);
  });

  test('PDF compression always produces a safe result, even when original is smaller', async ({ page }) => {
    await page.goto('/compress-pdf');
    await page.locator('#file-input').setInputFiles(fixture('sample.pdf'));
    await page.locator('#action-btn').click();

    await expect(page.locator('#pdf-tool-result .btn--success')).toBeVisible({ timeout: 20_000 });
  });

  test('HTML to PDF converts sanitized self-contained HTML', async ({ page }) => {
    await page.goto('/html-to-pdf');
    await page.locator('#file-input').setInputFiles({
      name: 'sample.html',
      mimeType: 'text/html',
      buffer: Buffer.from('<!doctype html><html><head><style>body{font-family:sans-serif}h1{font-size:32px}</style></head><body><h1>IrisFiles HTML test</h1><p>Local content only.</p><script>window.__shouldNotRun=true</script><img src="https://example.com/tracker.png"></body></html>'),
    });

    await page.locator('#action-btn').click();
    await expect(page.locator('#html-pdf-result .btn--success')).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => page.evaluate(() => window.__shouldNotRun === true)).toBe(false);
  });
});
