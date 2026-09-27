import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

async function animationInfo(page, bytes, type) {
  return page.evaluate(async ({ bytes, type }) => {
    const decoder = new ImageDecoder({
      data: new Uint8Array(bytes),
      type,
      preferAnimation: true,
    });
    try {
      await decoder.tracks.ready;
      await decoder.completed;
      const track = decoder.tracks.selectedTrack;
      const durations = [];
      for (let frameIndex = 0; frameIndex < track.frameCount; frameIndex++) {
        const { image } = await decoder.decode({ frameIndex });
        durations.push(image.duration ?? 0);
        image.close();
      }
      return {
        animated: track.animated,
        frameCount: track.frameCount,
        repetitionCount: track.repetitionCount,
        durations,
      };
    } finally {
      decoder.close();
    }
  }, { bytes: Array.from(bytes), type });
}

test.describe('Animated WebP to GIF', () => {
  test('preserves frames, loop count, and total timing', async ({ page }) => {
    await page.goto('/webp-to-gif');
    const canInspectAnimation = await page.evaluate(async () => {
      if (typeof ImageDecoder === 'undefined' || typeof ImageDecoder.isTypeSupported !== 'function') return false;
      return (await ImageDecoder.isTypeSupported('image/webp'))
        && (await ImageDecoder.isTypeSupported('image/gif'));
    });
    test.skip(!canInspectAnimation, 'WebCodecs ImageDecoder is required to verify animated output');

    const sourceBytes = await readFile(fixture('animated.webp'));
    const source = await animationInfo(page, sourceBytes, 'image/webp');
    expect(source.animated).toBe(true);
    expect(source.frameCount).toBeGreaterThan(1);

    await page.locator('#file-input').setInputFiles(fixture('animated.webp'));
    await page.locator('.file-item.done').first().waitFor({ timeout: 20_000 });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.btn-download').first().click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.gif$/);

    const outputBytes = await readFile(await download.path());
    expect(outputBytes.subarray(0, 6).toString('ascii')).toMatch(/^GIF8[79]a$/);

    const output = await animationInfo(page, outputBytes, 'image/gif');
    expect(output.animated).toBe(true);
    expect(output.frameCount).toBe(source.frameCount);
    expect(output.repetitionCount).toBe(source.repetitionCount);

    const sourceMs = source.durations.reduce((sum, duration) => sum + duration, 0) / 1000;
    const outputMs = output.durations.reduce((sum, duration) => sum + duration, 0) / 1000;
    expect(Math.abs(outputMs - sourceMs)).toBeLessThanOrEqual(source.frameCount * 10);
  });
});
