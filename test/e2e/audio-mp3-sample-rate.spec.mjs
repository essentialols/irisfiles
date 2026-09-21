import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { fixture, expectDownloadOnClick } from './helpers.mjs';

const MPEG_SAMPLE_RATES = {
  0: [11025, 12000, 8000],
  2: [22050, 24000, 16000],
  3: [44100, 48000, 32000],
};

function readMp3SampleRate(bytes) {
  let start = 0;
  if (
    bytes.length >= 10 &&
    bytes[0] === 0x49 &&
    bytes[1] === 0x44 &&
    bytes[2] === 0x33
  ) {
    const tagSize =
      ((bytes[6] & 0x7f) << 21) |
      ((bytes[7] & 0x7f) << 14) |
      ((bytes[8] & 0x7f) << 7) |
      (bytes[9] & 0x7f);
    start = 10 + tagSize + (bytes[5] & 0x10 ? 10 : 0);
  }

  for (let offset = start; offset + 4 <= bytes.length; offset++) {
    const b0 = bytes[offset];
    const b1 = bytes[offset + 1];
    const b2 = bytes[offset + 2];
    if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) continue;

    const versionBits = (b1 >> 3) & 0x03;
    const layerBits = (b1 >> 1) & 0x03;
    const bitrateIndex = (b2 >> 4) & 0x0f;
    const sampleRateIndex = (b2 >> 2) & 0x03;
    if (
      versionBits === 1 ||
      layerBits === 0 ||
      bitrateIndex === 0 ||
      bitrateIndex === 0x0f ||
      sampleRateIndex === 0x03
    ) {
      continue;
    }

    return MPEG_SAMPLE_RATES[versionBits][sampleRateIndex];
  }

  throw new Error('Downloaded file did not contain a valid MPEG audio frame');
}

async function convertToMp3(page, route, fixtureName) {
  await page.goto(route);
  await page.locator('#file-input').setInputFiles(fixture(fixtureName));
  await page.locator('.file-item.done').first().waitFor({ timeout: 45_000 });

  const download = await expectDownloadOnClick(page, '.btn-download');
  expect(download.suggestedFilename()).toMatch(/\.mp3$/);

  const outputPath = await download.path();
  expect(outputPath).toBeTruthy();
  const mp3 = await readFile(outputPath);
  expect(mp3.length).toBeGreaterThan(1000);
  return readMp3SampleRate(mp3);
}

// Web Audio decodes into the AudioContext's sample rate. These source files
// straddle the two common browser/device defaults, so on current main at least
// one is silently resampled before lamejs sees it. The downloaded MP3 frame
// header is the contract here, not merely the AudioBuffer used internally.
test.describe('MP3 source sample-rate preservation', () => {
  test('keeps a 48 kHz FLAC at 48 kHz in the downloaded MP3', async ({ page }) => {
    const sampleRate = await convertToMp3(
      page,
      '/flac-to-mp3',
      'stereo-48000.flac',
    );
    expect(sampleRate).toBe(48000);
  });

  test('keeps a 44.1 kHz M4A at 44.1 kHz in the downloaded MP3', async ({ page }) => {
    const sampleRate = await convertToMp3(page, '/m4a-to-mp3', 'sample.m4a');
    expect(sampleRate).toBe(44100);
  });

  // MPEG-2 rates are a separate frame-header version from the 44.1/48 kHz
  // cases above, and this page converts at the 128 kbps default, which that
  // version can carry. A source rate is only worth keeping when the requested
  // bitrate survives it; see mp3CanCarry in js/audio-engine.js.
  test('keeps a 22.05 kHz FLAC at 22.05 kHz in the downloaded MP3', async ({ page }) => {
    const sampleRate = await convertToMp3(
      page,
      '/flac-to-mp3',
      'stereo-22050.flac',
    );
    expect(sampleRate).toBe(22050);
  });
});
