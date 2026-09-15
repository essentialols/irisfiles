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

test.describe('AAC source sample rate', () => {
  test('AAC to WAV preserves a 48 kHz ADTS source rate', async ({ page }) => {
    // sample.aac is genuine 44.1 kHz ADTS AAC. The sampling-frequency index
    // lives in every ADTS frame header, so changing index 4 -> 3 produces a
    // genuine 48 kHz ADTS stream without pretending another format is AAC.
    const source = readFileSync(fixture('sample.aac'));
    const input = rewriteAdtsSampleRate(source, 3);

    await page.goto('/aac-to-wav');
    await page.locator('#file-input').setInputFiles({
      name: 'stereo-48000.aac',
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
    expect(output.readUInt16LE(22)).toBe(2);
    expect(output.readUInt32LE(24)).toBe(48_000);
  });
});
