import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { fixture, expectDownloadOnClick } from './helpers.mjs';

async function convertToWav(page, route, fixtureName) {
  await page.goto(route);

  await page.locator('#file-input').setInputFiles(fixture(fixtureName));
  await page.locator('.file-item.done').first().waitFor({ timeout: 45000 });

  const download = await expectDownloadOnClick(page, '.btn-download');
  expect(download.suggestedFilename()).toMatch(/\.wav$/);

  const outputPath = await download.path();
  expect(outputPath).toBeTruthy();
  const wav = await readFile(outputPath);

  expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
  expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
  return wav.readUInt32LE(24);
}

// The sibling FLAC spec pairs a 44.1 and a 48 kHz fixture because either could
// be the device default. These fixtures are 22.05 and 32 kHz, which no browser
// uses as an AudioContext default, so a single fixture each proves the reader
// ran: without it the output inherits the default and cannot be 22050 or 32000.
test.describe('Ogg and MP3 to WAV sample-rate preservation', () => {
  test('keeps a 22.05 kHz Vorbis Ogg at 22.05 kHz in the downloaded WAV', async ({ page }) => {
    expect(await convertToWav(page, '/ogg-to-wav', 'stereo-22050.ogg')).toBe(22050);
  });

  test('keeps a 32 kHz MP3 at 32 kHz in the downloaded WAV', async ({ page }) => {
    expect(await convertToWav(page, '/mp3-to-wav', 'mono-32000.mp3')).toBe(32000);
  });

  // The MP3 reader walks a bare frame header rather than a container, so it is
  // the one that can misfire on another format. An earlier implementation
  // scanned for a frame sync anywhere in the file and reported 32000 for both
  // of these 44.1 kHz fixtures, which would have regressed the working M4A and
  // AAC paths that already had their own readers.
  test('does not let the MP3 reader claim a rate for AAC or M4A sources', async ({ page }) => {
    expect(await convertToWav(page, '/aac-to-wav', 'sample.aac')).toBe(44100);
    expect(await convertToWav(page, '/m4a-to-wav', 'sample.m4a')).toBe(44100);
  });
});
