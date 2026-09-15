import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

async function setQuality(page, value) {
  await page.locator('#quality-slider').evaluate((slider, nextValue) => {
    slider.value = String(nextValue);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function downloadCurrent(page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.btn-download').first().click(),
  ]);
  return readFile(await download.path());
}

test('quality changed during ICO conversion is applied to the downloaded JPG', async ({ page }) => {
  // Hold decoding long enough to change the setting after processFile() has
  // captured the old quality but before the conversion completes.
  await page.addInitScript(() => {
    const originalCreateImageBitmap = window.createImageBitmap.bind(window);
    window.__irisBitmapCalls = 0;
    window.createImageBitmap = async (...args) => {
      window.__irisBitmapCalls += 1;
      const bitmap = await originalCreateImageBitmap(...args);
      await new Promise(resolve => setTimeout(resolve, 300));
      return bitmap;
    };
  });

  await page.goto('/ico-to-jpg');
  await setQuality(page, 10);
  await page.locator('#file-input').setInputFiles(fixture('sample.ico'));
  await expect(page.locator('.file-item__status').first()).toHaveText('Converting...');
  await expect.poll(() => page.evaluate(() => window.__irisBitmapCalls)).toBe(1);

  // This used to update the visible slider while the in-flight conversion kept
  // its captured 10% quality and then published that stale result as complete.
  await setQuality(page, 100);

  await page.locator('.file-item.done').first().waitFor({ timeout: 15000 });
  await expect.poll(() => page.evaluate(() => window.__irisBitmapCalls)).toBe(2);
  const changedDuringRun = await downloadCurrent(page);

  // A conversion started fresh at 100% must be byte-for-byte identical to the
  // result produced after changing to 100% during the previous run.
  await page.locator('.btn-remove').first().click();
  await expect(page.locator('.file-item')).toHaveCount(0);
  await page.evaluate(() => { window.__irisBitmapCalls = 0; });
  await page.locator('#file-input').setInputFiles(fixture('sample.ico'));
  await page.locator('.file-item.done').first().waitFor({ timeout: 15000 });
  await expect.poll(() => page.evaluate(() => window.__irisBitmapCalls)).toBe(1);
  const freshAtFinalQuality = await downloadCurrent(page);

  expect(changedDuringRun).toEqual(freshAtFinalQuality);
});
