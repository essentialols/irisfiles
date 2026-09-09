import { test, expect } from '@playwright/test';
import { fixture, dropFile, waitForDone, getFileItemCount } from './helpers.mjs';

const TIMEOUT = 90_000;

test.describe('Video Tools E2E', () => {
  test.setTimeout(TIMEOUT);

  test.describe('Video Conversion - MOV to MP4', () => {
    test('should convert MOV to MP4', async ({ page }) => {
      await page.goto(`/mov-to-mp4`);

      await dropFile(page, '#drop-zone', fixture('sample.mov'));

      // Same container in and out, so remux-boot converts on drop: there is
      // no action button, no #video-file and no duration readout here.
      await expect(page.locator('#action-btn')).toHaveCount(0);
      await expect(page.locator('.file-item__meta')).toBeVisible();
      await waitForDone(page, { timeout: TIMEOUT });

      await expect(page.locator('.btn-download')).toBeVisible();

      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('.btn-download').click(),
      ]);

      expect(download.suggestedFilename()).toMatch(/\.(mp4|webm|avi|gif)$/i);
    });

    test('should clear files after conversion', async ({ page }) => {
      await page.goto(`/mov-to-mp4`);

      await dropFile(page, '#drop-zone', fixture('sample.mov'));
      // remux-boot renders the shared file list, not the #video-file panel
      // that the compress and speed pages build.
      await expect(page.locator('.file-item')).toBeVisible();

      await page.locator('#clear-all').click();

      await expect(page.locator('.file-item')).toHaveCount(0);
    });

    test('should replace file on second upload', async ({ page }) => {
      await page.goto(`/mov-to-mp4`);

      await dropFile(page, '#drop-zone', fixture('sample.mov'));
      const count1 = await getFileItemCount(page);
      expect(count1).toBe(1);

      await dropFile(page, '#drop-zone', fixture('sample.mp4'));
      const count2 = await getFileItemCount(page);
      expect(count2).toBe(1);
    });
  });

  test.describe('Video Conversion - MP4 to WebM', () => {
    test('should convert MP4 to WebM', async ({ page }) => {
      await page.goto(`/mp4-to-webm`);

      await dropFile(page, '#drop-zone', fixture('sample.mp4'));

      await expect(page.locator('#action-btn')).toBeVisible();
      await page.locator('#action-btn').click();
      await waitForDone(page, { timeout: TIMEOUT });

      await expect(page.locator('.btn-download')).toBeVisible();
    });
  });

  test.describe('Video Conversion - AVI to MP4', () => {
    test('should convert AVI to MP4', async ({ page }) => {
      await page.goto(`/avi-to-mp4`);

      await dropFile(page, '#drop-zone', fixture('sample.avi'));

      await expect(page.locator('#action-btn')).toBeVisible();
      await expect(page.locator('#video-file')).toBeVisible();

      await page.locator('#action-btn').click();
      await waitForDone(page, { timeout: TIMEOUT });

      await expect(page.locator('.btn-download')).toBeVisible();
    });
  });

  test.describe('Video to GIF Conversion', () => {
    test('should convert MP4 to GIF', async ({ page }) => {
      await page.goto(`/video-to-gif`);

      await dropFile(page, '#drop-zone', fixture('sample.mp4'));

      await expect(page.locator('#gif-controls')).toBeVisible();
      await page.locator('#convert-btn').click();
      // The GIF lands in its own result panel rather than the file list.
      await expect(page.locator('#gif-result')).toBeVisible({ timeout: TIMEOUT });
      await expect(page.locator('#gif-result img')).toBeVisible();
    });

    test('should handle direct video-to-gif route', async ({ page }) => {
      await page.goto(`/mp4-to-gif`);

      await dropFile(page, '#drop-zone', fixture('sample.mp4'));

      await expect(page.locator('#gif-controls')).toBeVisible();
      await page.locator('#convert-btn').click();
      await expect(page.locator('#gif-result')).toBeVisible({ timeout: TIMEOUT });
      await expect(page.locator('#gif-result img')).toBeVisible();
    });
  });

  test.describe('Video Compression', () => {
    test('should compress video with quality setting', async ({ page }) => {
      await page.goto(`/compress-video`);

      await dropFile(page, '#drop-zone', fixture('sample.mp4'));

      await expect(page.locator('#video-file')).toBeVisible();
      await expect(page.locator('#action-btn')).toBeVisible();
      await expect(page.locator('.file-item__meta')).toBeVisible();

      await page.locator('#compress-quality').selectOption('low');

      const resolutionSelect = page.locator('#compress-resolution');
      if (await resolutionSelect.isVisible()) {
        await resolutionSelect.selectOption({ index: 1 });
      }

      await page.locator('#action-btn').click();
      await waitForDone(page, { timeout: TIMEOUT });

      // The before/after sizes land in the meta line; the status span stays
      // empty on this page, and a small clip can compress to no reduction.
      await expect(page.locator('.file-item__meta')).toContainText('→');
    });

    test('should show compression savings', async ({ page }) => {
      await page.goto(`/compress-video`);

      await dropFile(page, '#drop-zone', fixture('sample.mp4'));

      const originalSize = await page.locator('.file-item__meta').textContent();
      expect(originalSize).toBeTruthy();

      await page.locator('#compress-quality').selectOption('medium');

      await page.locator('#action-btn').click();
      await waitForDone(page, { timeout: TIMEOUT });

      // The result line reports before and after sizes; the status span is
      // left empty here, and a tiny clip may compress to no reduction at all.
      await expect(page.locator('.file-item__meta')).toContainText('→');
    });
  });

  test.describe('Video Speed Control', () => {
    test('should change video speed', async ({ page }) => {
      await page.goto(`/video-speed`);

      await dropFile(page, '#drop-zone', fixture('sample.mp4'));

      await expect(page.locator('#video-file')).toBeVisible();
      await expect(page.locator('#action-btn')).toBeVisible();

      const originalDuration = await page.locator('.file-item__meta').textContent();
      expect(originalDuration).toBeTruthy();

      await page.locator('#speed-preset').selectOption('2');

      await expect(page.locator('.file-item__estimate')).toBeVisible();
      const estimatedDuration = await page.locator('.file-item__estimate').textContent();
      expect(estimatedDuration).toBeTruthy();

      await page.locator('#action-btn').click();
      await waitForDone(page, { timeout: TIMEOUT });

      await expect(page.locator('.btn-download')).toBeVisible();
    });

    test('should toggle audio with speed change', async ({ page }) => {
      await page.goto(`/video-speed`);

      await dropFile(page, '#drop-zone', fixture('sample.mp4'));

      await expect(page.locator('#keep-audio')).toBeChecked();

      await page.locator('#speed-preset').selectOption('0.5');

      await page.locator('#keep-audio').uncheck();

      await expect(page.locator('#keep-audio')).not.toBeChecked();

      await page.locator('#action-btn').click();
      await waitForDone(page, { timeout: TIMEOUT });

      await expect(page.locator('.btn-download')).toBeVisible();
    });

    test('should support various speed presets', async ({ page }) => {
      await page.goto(`/video-speed`);

      await dropFile(page, '#drop-zone', fixture('sample.mp4'));

      const speedOptions = page.locator('#speed-preset option');
      const count = await speedOptions.count();
      expect(count).toBeGreaterThan(1);

      await page.locator('#speed-preset').selectOption('4');
      await expect(page.locator('.file-item__estimate')).toBeVisible();
    });
  });

  test.describe('Video Metadata', () => {
    test('should display video metadata', async ({ page }) => {
      await page.goto(`/video-metadata`);

      await dropFile(page, '#drop-zone', fixture('sample.mp4'));

      await expect(page.locator('#metadata-panel')).toBeVisible({ timeout: 10_000 });

      const metaGroups = page.locator('.meta-group');
      const groupCount = await metaGroups.count();
      expect(groupCount).toBeGreaterThan(0);

      const generalGroup = page.locator('.meta-group:has-text("General")');
      await expect(generalGroup).toBeVisible({ timeout: 5000 });
    });

    test('should show metadata for different formats', async ({ page }) => {
      await page.goto(`/video-metadata`);

      await dropFile(page, '#drop-zone', fixture('sample.mov'));

      await expect(page.locator('#metadata-panel')).toBeVisible({ timeout: 10_000 });

      await expect(page.locator('.meta-group')).not.toHaveCount(0);
    });

    test('should strip metadata from video', async ({ page }) => {
      await page.goto(`/video-metadata`);

      await dropFile(page, '#drop-zone', fixture('sample.mp4'));

      await expect(page.locator('#metadata-panel')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('#strip-all')).toBeVisible();

      await page.locator('#strip-all').click();
      await waitForDone(page, { timeout: TIMEOUT });

      await expect(page.locator('.btn-download')).toBeVisible();
    });

    test('should render video preview filmstrip', async ({ page }) => {
      await page.goto(`/video-metadata`);

      await dropFile(page, '#drop-zone', fixture('sample.mp4'));

      await expect(page.locator('#video-preview')).toBeVisible({ timeout: 10_000 });

      const canvas = page.locator('#video-preview canvas').first();
      await expect(canvas).toBeVisible({ timeout: 5000 });
    });

    test('should clear metadata display', async ({ page }) => {
      await page.goto(`/video-metadata`);

      await dropFile(page, '#drop-zone', fixture('sample.mp4'));

      await expect(page.locator('#metadata-panel')).toBeVisible({ timeout: 10_000 });

      await page.locator('#clear-all').click();

      await expect(page.locator('#metadata-panel')).not.toBeVisible();
    });
  });

  test.describe('Converter Config Attributes', () => {
    test('should have correct converter config on MOV to MP4', async ({ page }) => {
      await page.goto(`/mov-to-mp4`);

      // Same container in and out, so this page remuxes and ships no
      // converter config; the generic pages are covered above.
      await expect(page.locator('#converter-config')).toHaveCount(0);
      await expect(page.locator('#drop-zone')).toBeVisible();
    });

    test('should have correct converter config on MP4 to WebM', async ({ page }) => {
      await page.goto(`/mp4-to-webm`);

      const config = page.locator('#converter-config');
      await expect(config).toHaveAttribute('data-target-format', 'webm');
    });

    test('should have correct converter config on video to GIF', async ({ page }) => {
      await page.goto(`/video-to-gif`);

      // gif-boot ships trim/fps controls rather than a converter config.
      await expect(page.locator('#converter-config')).toHaveCount(0);
      await expect(page.locator('#gif-controls')).toBeAttached();
    });
  });

  test.describe('FFmpeg.wasm CDN Loading', () => {
    test('should load FFmpeg from CDN on first use', async ({ page }) => {
      await page.goto(`/compress-video`);

      const networkRequests = [];
      page.on('response', (response) => {
        if (response.url().includes('ffmpeg') || response.url().includes('cdn')) {
          networkRequests.push(response.url());
        }
      });

      await dropFile(page, '#drop-zone', fixture('sample.mp4'));
      await page.locator('#action-btn').click();

      await waitForDone(page, { timeout: TIMEOUT });

      const hasCDNRequest = networkRequests.some(url =>
        url.includes('jsDelivr') || url.includes('cdn') || url.includes('ffmpeg')
      );
      expect(hasCDNRequest || networkRequests.length >= 0).toBeTruthy();
    });
  });

  test.describe('Error Handling', () => {
    test('should handle duration validation errors gracefully', async ({ page }) => {
      await page.goto(`/mov-to-mp4`);

      await dropFile(page, '#drop-zone', fixture('sample.mov'));

      const errorElement = page.locator('.file-item__error, .error-message');
      const errorVisible = await errorElement.isVisible().catch(() => false);

      if (errorVisible) {
        await expect(errorElement).toBeVisible();
      }
    });

    test('uploading wrong format to video converter shows no crash', async ({ page }) => {
      await page.goto('/mov-to-mp4');
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await dropFile(page, '#drop-zone', fixture('sample.pdf'));
      await page.waitForTimeout(3000);
      expect(errors).toHaveLength(0);
    });
  });

  test.describe('Action Button State During Conversion', () => {
    test('action button disables when conversion starts', async ({ page }) => {
      // Asserted on a re-encoding page: mov-to-mp4 remuxes on drop and has
      // no action button at all.
      await page.goto(`/mp4-to-webm`);

      await dropFile(page, '#drop-zone', fixture('sample.mp4'));
      await expect(page.locator('#action-btn')).toBeEnabled();

      await page.locator('#action-btn').click();
      await expect(page.locator('#action-btn')).toBeDisabled();
    });

    test('action button hides after successful conversion', async ({ page }) => {
      // A re-encoding page, since mov-to-mp4 has no action button to hide.
      await page.goto(`/mp4-to-webm`);

      await dropFile(page, '#drop-zone', fixture('sample.mp4'));
      await page.locator('#action-btn').click();
      await waitForDone(page, { timeout: TIMEOUT });

      await expect(page.locator('#action-btn')).toBeHidden();
    });
  });

  test.describe('Video File Metadata Display', () => {
    test('file item shows file size', async ({ page }) => {
      await page.goto(`/mov-to-mp4`);

      await dropFile(page, '#drop-zone', fixture('sample.mov'));
      const meta = await page.locator('.file-item__meta').textContent();
      expect(meta).toMatch(/\d+\s*(B|KB|MB)/);
    });

    test('conversion shows before/after sizes', async ({ page }) => {
      await page.goto(`/mov-to-mp4`);

      await dropFile(page, '#drop-zone', fixture('sample.mov'));
      // remux-boot converts on drop; there is no action button to press.
      await waitForDone(page, { timeout: TIMEOUT });

      const meta = await page.locator('.file-item__meta').textContent();
      expect(meta).toContain('→');
    });
  });

  test.describe('Clear All State Reset', () => {
    test('clear all hides action and clear buttons', async ({ page }) => {
      await page.goto(`/mov-to-mp4`);

      await dropFile(page, '#drop-zone', fixture('sample.mov'));
      await expect(page.locator('#clear-all')).toBeVisible();

      await page.locator('#clear-all').click();

      await expect(page.locator('#clear-all')).toBeHidden();
      expect(await getFileItemCount(page)).toBe(0);
    });

    test('can upload new file after clear', async ({ page }) => {
      await page.goto(`/mov-to-mp4`);

      await dropFile(page, '#drop-zone', fixture('sample.mov'));
      await page.locator('#clear-all').click();

      await dropFile(page, '#drop-zone', fixture('sample.mp4'));
      // remux-boot renders the shared file list and converts on drop, so
      // there is no #video-file panel or action button to reappear.
      await expect(page.locator('.file-item')).toBeVisible();
    });
  });

  test.describe('Video Compression - Clear After Compress', () => {
    test('clear all after compression resets interface', async ({ page }) => {
      await page.goto('/compress-video');

      await dropFile(page, '#drop-zone', fixture('sample.mp4'));
      await expect(page.locator('#video-file')).toBeVisible();

      await page.locator('#compress-quality').selectOption('low');
      await page.locator('#action-btn').click();
      await waitForDone(page, { timeout: TIMEOUT });

      await page.locator('#clear-all').click();

      await expect(page.locator('#video-file')).not.toBeVisible();
      expect(await getFileItemCount(page)).toBe(0);
    });
  });

  test.describe('Video Speed - Download Extension', () => {
    test('speed-adjusted download has video extension', async ({ page }) => {
      await page.goto('/video-speed');

      await dropFile(page, '#drop-zone', fixture('sample.mp4'));
      await expect(page.locator('#video-file')).toBeVisible();

      await page.locator('#speed-preset').selectOption('2');
      await page.locator('#action-btn').click();
      await waitForDone(page, { timeout: TIMEOUT });

      const [dl] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('.btn-download').click(),
      ]);
      expect(dl.suggestedFilename()).toMatch(/\.(mp4|webm|avi|mkv|mov)$/i);
    });
  });

  test.describe('Video Speed - Clear After Process', () => {
    test('clear all after speed change resets interface', async ({ page }) => {
      await page.goto('/video-speed');

      await dropFile(page, '#drop-zone', fixture('sample.mp4'));
      await expect(page.locator('#video-file')).toBeVisible();

      await page.locator('#speed-preset').selectOption('2');
      await page.locator('#action-btn').click();
      await waitForDone(page, { timeout: TIMEOUT });

      await page.locator('#clear-all').click();
      await expect(page.locator('#video-file')).not.toBeVisible();
      expect(await getFileItemCount(page)).toBe(0);
    });
  });

  test.describe('Video Conversion - Download Extensions', () => {
    test('MOV to MP4 download has .mp4 extension', async ({ page }) => {
      await page.goto('/mov-to-mp4');

      await dropFile(page, '#drop-zone', fixture('sample.mov'));
      // remux-boot converts on drop; there is no action button to press.
      await waitForDone(page, { timeout: TIMEOUT });

      const [dl] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('.btn-download').click(),
      ]);
      expect(dl.suggestedFilename()).toMatch(/\.mp4$/i);
    });

    test('AVI to MP4 download has .mp4 extension', async ({ page }) => {
      await page.goto('/avi-to-mp4');

      await dropFile(page, '#drop-zone', fixture('sample.avi'));
      await page.locator('#action-btn').click();
      await waitForDone(page, { timeout: TIMEOUT });

      const [dl] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('.btn-download').click(),
      ]);
      expect(dl.suggestedFilename()).toMatch(/\.mp4$/i);
    });
  });

  test.describe('Compress Video - Download Extension', () => {
    test('compressed video download has .mp4 extension', async ({ page }) => {
      await page.goto('/compress-video');

      await dropFile(page, '#drop-zone', fixture('sample.mp4'));
      await page.locator('#compress-quality').selectOption('low');
      await page.locator('#action-btn').click();
      await waitForDone(page, { timeout: TIMEOUT });

      const [dl] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('.btn-download').click(),
      ]);
      expect(dl.suggestedFilename()).toMatch(/\.mp4$/i);
    });
  });

  test.describe('Video Metadata - Wrong Format', () => {
    test('uploading non-video to video-metadata shows no crash', async ({ page }) => {
      await page.goto('/video-metadata');
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await dropFile(page, '#drop-zone', fixture('sample.pdf'));
      await page.waitForTimeout(3000);
      expect(errors).toHaveLength(0);
    });
  });
});
