import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { fixture, expectDownloadOnClick } from './helpers.mjs';

async function convertM4aToWav(page, fixtureName) {
  await page.goto('/m4a-to-wav');

  await page.locator('#file-input').setInputFiles(fixture(fixtureName));
  await page.locator('.file-item.done').first().waitFor({ timeout: 45000 });

  const download = await expectDownloadOnClick(page, '.btn-download');
  expect(download.suggestedFilename()).toMatch(/\.wav$/);

  const outputPath = await download.path();
  expect(outputPath).toBeTruthy();
  const wav = await readFile(outputPath);

  expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
  expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
  return { channels: wav.readUInt16LE(22), sampleRate: wav.readUInt32LE(24) };
}

// Web Audio decodes into the AudioContext's sample rate. The fixture corpus
// intentionally contains M4A/AAC at both common rates so this catches silent
// 44.1 <-> 48 kHz resampling regardless of Chromium's device default.
test.describe('M4A to WAV sample-rate preservation', () => {
  test('keeps a 48 kHz M4A at 48 kHz in the downloaded WAV', async ({ page }) => {
    const { channels, sampleRate } = await convertM4aToWav(page, 'long.m4a');
    expect(channels).toBe(2);
    expect(sampleRate).toBe(48000);
  });

  test('keeps a 44.1 kHz M4A at 44.1 kHz in the downloaded WAV', async ({ page }) => {
    const { channels, sampleRate } = await convertM4aToWav(page, 'sample.m4a');
    expect(channels).toBe(2);
    expect(sampleRate).toBe(44100);
  });
});
