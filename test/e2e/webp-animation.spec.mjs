import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

async function animationInfo(page, bytes, type) {
  return page.evaluate(async ({ bytes, type }) => {
    const decoder = new ImageDecoder({ data: new Uint8Array(bytes), type, preferAnimation: true });
    try {
      await decoder.tracks.ready;
      await decoder.completed;
      const track = decoder.tracks.selectedTrack;
      let totalMs = 0;
      for (let frameIndex = 0; frameIndex < track.frameCount; frameIndex++) {
        const { image } = await decoder.decode({ frameIndex });
        totalMs += (image.duration ?? 0) / 1000;
        image.close();
      }
      return { animated: track.animated, frameCount: track.frameCount, repetitionCount: track.repetitionCount, totalMs };
    } finally {
      decoder.close();
    }
  }, { bytes: Array.from(bytes), type });
}

async function openConverter(page) {
  await page.goto('/webp-to-gif');
  const supported = await page.evaluate(async () => (
    typeof ImageDecoder !== 'undefined'
    && await ImageDecoder.isTypeSupported('image/webp')
    && await ImageDecoder.isTypeSupported('image/gif')
  ));
  test.skip(!supported, 'WebCodecs ImageDecoder is required to verify animated output');
}

// Convert in the page and hand back the downloaded GIF bytes.
async function convertToGif(page, buffer) {
  await page.locator('#file-input').setInputFiles({ name: 'anim.webp', mimeType: 'image/webp', buffer });
  await page.locator('.file-item.done').first().waitFor({ timeout: 15_000 });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.btn-download').first().click(),
  ]);
  return readFile(await download.path());
}

test.describe('Animated WebP to GIF', () => {
  test('preserves frames, loop count, and total timing', async ({ page }) => {
    await openConverter(page);
    const bytes = await readFile(fixture('animated.webp'));
    const source = await animationInfo(page, bytes, 'image/webp');
    expect(source.frameCount).toBeGreaterThan(1);

    const gif = await convertToGif(page, bytes);
    const output = await animationInfo(page, gif, 'image/gif');
    expect(output.animated).toBe(true);
    expect(output.frameCount).toBe(source.frameCount);
    expect(output.repetitionCount).toBe(source.repetitionCount);
    // GIF delays are whole centiseconds, so allow 10 ms of rounding per frame.
    expect(Math.abs(output.totalMs - source.totalMs)).toBeLessThanOrEqual(source.frameCount * 10);
  });

  test('a play-once animation does not become an endless loop', async ({ page }) => {
    await openConverter(page);
    const bytes = Buffer.from(await readFile(fixture('animated.webp')));
    // ANIM chunk payload: 4-byte background colour, then the 16-bit loop count.
    bytes.writeUInt16LE(1, bytes.indexOf('ANIM') + 8 + 4);
    const source = await animationInfo(page, bytes, 'image/webp');
    expect(source.repetitionCount).not.toBe(Infinity);

    const output = await animationInfo(page, await convertToGif(page, bytes), 'image/gif');
    expect(output.repetitionCount).toBe(source.repetitionCount);
  });

  test('reports a corrupted animated WebP instead of producing a download', async ({ page }) => {
    await openConverter(page);
    const bytes = await readFile(fixture('animated.webp'));
    await page.locator('#file-input').setInputFiles({
      name: 'broken-animation.webp',
      mimeType: 'image/webp',
      buffer: bytes.subarray(0, bytes.indexOf('ANIM') + 10),
    });

    const error = page.locator('.file-item__status.error').first();
    await expect(error).toContainText('Could not decode animated WebP', { timeout: 15_000 });
    await expect(page.locator('.btn-download')).toHaveCount(0);
  });
});
