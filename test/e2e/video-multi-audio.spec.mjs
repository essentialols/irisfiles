import fs from 'node:fs/promises';
import { test, expect } from '@playwright/test';

test.setTimeout(120000);

const MULTI_AUDIO_MKV = new URL('../fixtures/multi-audio.mkv', import.meta.url);

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
    buffer: await fs.readFile(MULTI_AUDIO_MKV),
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
