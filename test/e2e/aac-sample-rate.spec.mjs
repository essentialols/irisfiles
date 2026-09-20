import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

function rewriteAdtsSampleRate(source, sampleRateIndex) {
  const bytes = Buffer.from(source);
  let offset = 0;
  let frames = 0;

  while (offset + 7 <= bytes.length) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xf6) !== 0xf0) {
      throw new Error(`Invalid ADTS sync word at byte ${offset}`);
    }

    bytes[offset + 2] =
      (bytes[offset + 2] & 0xc3) | (sampleRateIndex << 2);

    const frameLength =
      ((bytes[offset + 3] & 0x03) << 11) |
      (bytes[offset + 4] << 3) |
      (bytes[offset + 5] >> 5);
    if (frameLength < 7 || offset + frameLength > bytes.length) {
      throw new Error(`Invalid ADTS frame length at byte ${offset}`);
    }

    offset += frameLength;
    frames++;
  }

  if (frames === 0 || offset !== bytes.length) {
    throw new Error('Fixture did not contain a complete ADTS stream');
  }

  return bytes;
}

// sample.aac is genuine 44.1 kHz ADTS AAC. The sampling-frequency index lives
// in every ADTS frame header, so rewriting it produces a genuine stream at the
// new rate without pretending another format is AAC.
async function convertAacToWav(page, sampleRateIndex, name) {
  const input = rewriteAdtsSampleRate(readFileSync(fixture('sample.aac')), sampleRateIndex);

  await page.goto('/aac-to-wav');
  await page.locator('#file-input').setInputFiles({
    name,
    mimeType: 'audio/aac',
    buffer: input,
  });
  await page.locator('.file-item.done').waitFor({ timeout: 45_000 });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.btn-download').click(),
  ]);
  const output = readFileSync(await download.path());

  expect(output.subarray(0, 4).toString('ascii')).toBe('RIFF');
  expect(output.subarray(8, 12).toString('ascii')).toBe('WAVE');
  return { channels: output.readUInt16LE(22), sampleRate: output.readUInt32LE(24) };
}

// An AudioContext resamples to the device's default rate, which is usually
// 44100 or 48000. Asserting one rate would silently pass on whichever machine
// already defaults to that rate -- verified: the 48 kHz case alone still passes
// with the ADTS reader removed. Both rates are checked so that whatever the
// default is, at least one of them has to survive resampling.
test.describe('AAC source sample rate', () => {
  test('AAC to WAV preserves a 48 kHz ADTS source rate', async ({ page }) => {
    const { channels, sampleRate } = await convertAacToWav(page, 3, 'stereo-48000.aac');
    expect(channels).toBe(2);
    expect(sampleRate).toBe(48_000);
  });

  test('AAC to WAV preserves a 44.1 kHz ADTS source rate', async ({ page }) => {
    const { channels, sampleRate } = await convertAacToWav(page, 4, 'stereo-44100.aac');
    expect(channels).toBe(2);
    expect(sampleRate).toBe(44_100);
  });

  test('the two rates do not both match the browser default rate', async ({ page }) => {
    await page.goto('/aac-to-wav');
    const defaultRate = await page.evaluate(() => {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const rate = ctx.sampleRate;
      ctx.close();
      return rate;
    });
    expect([48_000, 44_100].filter(r => r !== defaultRate).length).toBeGreaterThan(0);
  });
});
