import fs from 'node:fs/promises';
import { test, expect } from '@playwright/test';

test.setTimeout(120000);

// Genuine 64x64 H.264 Matroska with two mono AAC tracks. The tracks are
// tagged eng and jpn and contain different tones. Keeping the fixture inline
// makes this regression deterministic without adding a fixture generator.
const MULTI_AUDIO_MKV = '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';

function countMp4Handler(output, handler) {
  let count = 0;
  let offset = 0;
  const marker = Buffer.from('hdlr');
  while ((offset = output.indexOf(marker, offset)) !== -1) {
    // hdlr box: type (4), version/flags (4), pre_defined (4), handler_type (4).
    if (output.subarray(offset + 12, offset + 16).toString('ascii') === handler) count++;
    offset += marker.length;
  }
  return count;
}

test('MKV to MP4 preserves all audio tracks', async ({ page }) => {
  await page.goto('/mkv-to-mp4');
  await page.locator('#file-input').setInputFiles({
    name: 'Résumé_日本語_multi-audio.mkv',
    mimeType: 'video/x-matroska',
    buffer: Buffer.from(MULTI_AUDIO_MKV, 'base64'),
  });

  await expect(page.locator('.file-item__name')).toHaveText('Résumé_日本語_multi-audio.mkv');
  await expect(page.locator('#action-btn')).toBeEnabled();
  await page.locator('#action-btn').click();
  await expect(page.locator('.btn-download')).toBeVisible({ timeout: 120000 });

  const downloadPromise = page.waitForEvent('download');
  await page.locator('.btn-download').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Résumé_日本語_multi-audio.mp4');

  const output = await fs.readFile(await download.path());
  expect(countMp4Handler(output, 'vide')).toBe(1);
  expect(countMp4Handler(output, 'soun')).toBe(2);
});
