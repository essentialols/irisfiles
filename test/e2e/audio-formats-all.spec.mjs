import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

// Every pair asserted the same page shell across four separate tests, each
// paying its own navigation, and the twelve converting pairs ran the same
// FFmpeg conversion four times to reach four different post-conversion
// assertions. Same assertions, one navigation and two conversions per pair.
const PAIRS = [
  { source: 'MP3', fixture: 'sample.mp3', targets: [
    { name: 'WAV', route: '/mp3-to-wav', format: 'wav', ext: 'wav', converts: true },
    { name: 'OGG', route: '/mp3-to-ogg', format: 'ogg', ext: 'ogg', converts: true },
    { name: 'FLAC', route: '/mp3-to-flac', format: 'flac', ext: 'flac', converts: true },
    { name: 'M4A', route: '/mp3-to-m4a', format: 'm4a', ext: 'm4a', converts: true },
    { name: 'AAC', route: '/mp3-to-aac', format: 'aac', ext: 'aac', converts: true },
  ] },
  { source: 'WAV', fixture: 'sample.wav', targets: [
    { name: 'MP3', route: '/wav-to-mp3', format: 'mp3', ext: 'mp3', converts: true },
    { name: 'OGG', route: '/wav-to-ogg', format: 'ogg', ext: 'ogg', converts: true },
    { name: 'FLAC', route: '/wav-to-flac', format: 'flac', ext: 'flac', converts: true },
    { name: 'M4A', route: '/wav-to-m4a', format: 'm4a', ext: 'm4a', converts: true },
    { name: 'AAC', route: '/wav-to-aac', format: 'aac', ext: 'aac', converts: true },
  ] },
  { source: 'OGG', fixture: 'sample.ogg', targets: [
    { name: 'WAV', route: '/ogg-to-wav', format: 'wav', ext: 'wav', converts: true },
    { name: 'MP3', route: '/ogg-to-mp3', format: 'mp3', ext: 'mp3', converts: true },
    { name: 'FLAC', route: '/ogg-to-flac', format: 'flac', ext: 'flac' },
    { name: 'M4A', route: '/ogg-to-m4a', format: 'm4a', ext: 'm4a' },
    { name: 'AAC', route: '/ogg-to-aac', format: 'aac', ext: 'aac' },
  ] },
  { source: 'FLAC', fixture: 'sample.flac', targets: [
    { name: 'WAV', route: '/flac-to-wav', format: 'wav', ext: 'wav' },
    { name: 'MP3', route: '/flac-to-mp3', format: 'mp3', ext: 'mp3' },
    { name: 'OGG', route: '/flac-to-ogg', format: 'ogg', ext: 'ogg' },
    { name: 'M4A', route: '/flac-to-m4a', format: 'm4a', ext: 'm4a' },
    { name: 'AAC', route: '/flac-to-aac', format: 'aac', ext: 'aac' },
  ] },
  { source: 'M4A', fixture: 'sample.m4a', targets: [
    { name: 'WAV', route: '/m4a-to-wav', format: 'wav', ext: 'wav' },
    { name: 'MP3', route: '/m4a-to-mp3', format: 'mp3', ext: 'mp3' },
    { name: 'OGG', route: '/m4a-to-ogg', format: 'ogg', ext: 'ogg' },
    { name: 'FLAC', route: '/m4a-to-flac', format: 'flac', ext: 'flac' },
    { name: 'AAC', route: '/m4a-to-aac', format: 'aac', ext: 'aac' },
  ] },
  { source: 'AAC', fixture: 'sample.aac', targets: [
    { name: 'WAV', route: '/aac-to-wav', format: 'wav', ext: 'wav' },
    { name: 'MP3', route: '/aac-to-mp3', format: 'mp3', ext: 'mp3' },
    { name: 'OGG', route: '/aac-to-ogg', format: 'ogg', ext: 'ogg' },
    { name: 'FLAC', route: '/aac-to-flac', format: 'flac', ext: 'flac' },
    { name: 'M4A', route: '/aac-to-m4a', format: 'm4a', ext: 'm4a' },
  ] },
];

for (const { source, fixture: sourceFixture, targets } of PAIRS) {
  test.describe(`Audio Formats - ${source} Source`, () => {
    for (const target of targets) {
      test.describe(`${source} to ${target.name}`, () => {
        test.setTimeout(60000);

        test.beforeEach(async ({ page }) => {
          await page.goto(target.route);
        });

        test('page structure and target format are correct', async ({ page }) => {
          await expect(page.locator('#drop-zone')).toBeVisible();
          await expect(page.locator('#file-input')).toBeAttached();
          await expect(page.locator('#file-list')).toBeAttached();
          const config = page.locator('#converter-config');
          await expect(config).toBeAttached();
          await expect(config).toHaveAttribute('data-target-format', target.format);
          await expect(config).toHaveAttribute('data-target-ext', target.ext);
          await expect(page.locator('#download-all')).toBeHidden();
          await expect(page.locator('#clear-all')).toBeHidden();
        });

        if (!target.converts) return;

        test('converts the file and the result controls clear it', async ({ page }) => {
          await test.step('converts and offers a download', async () => {
            await page.locator('#file-input').setInputFiles(fixture(sourceFixture));
            await page.locator('.file-item.done').first().waitFor({ timeout: 45000 });
            await expect(page.locator('.file-item.done')).toBeVisible();
            await expect(page.locator('.btn-download').first()).toBeVisible();
          });

          await test.step('remove drops the converted file', async () => {
            await page.locator('.btn-remove').first().click();
            await expect(page.locator('.file-item')).toHaveCount(0);
          });

          // Reconverted rather than reusing the queued file: clear all has to
          // tear down a finished result, not just an entry in the list.
          await test.step('clear all drops a converted file', async () => {
            await page.locator('#file-input').setInputFiles(fixture(sourceFixture));
            await page.locator('.file-item.done').first().waitFor({ timeout: 45000 });
            await page.locator('#clear-all').click();
            await expect(page.locator('.file-item')).toHaveCount(0);
          });
        });
      });
    }
  });
}
