import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('Expected PNG output');
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function convertSvgToPng(page, svg, name = 'input.svg', mimeType = 'image/svg+xml') {
  await page.goto('/svg-to-png');
  await page.locator('#file-input').setInputFiles({
    name,
    mimeType,
    buffer: Buffer.from(svg),
  });
  await page.locator('.file-item.done').waitFor({ timeout: 15_000 });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.btn-download').click(),
  ]);
  return pngDimensions(await readFile(await download.path()));
}

test.describe('SVG raster dimensions', () => {
  test('viewBox-only SVG uses its viewBox dimensions instead of the browser 300x150 fallback', async ({ page }) => {
    const dimensions = await convertSvgToPng(page, `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400">
        <rect width="800" height="400" fill="#0f172a"/>
        <circle cx="200" cy="200" r="120" fill="#22c55e"/>
      </svg>
    `, 'viewbox-only.svg', 'application/octet-stream');

    expect(dimensions).toEqual({ width: 800, height: 400 });
  });

  test('explicit SVG width and height remain authoritative', async ({ page }) => {
    const dimensions = await convertSvgToPng(page, `
      <svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 600 400">
        <rect width="600" height="400" fill="#ef4444"/>
      </svg>
    `);

    expect(dimensions).toEqual({ width: 120, height: 80 });
  });

  // Rasterizing at the viewBox size sent that size straight into
  // validateDimensions(), so a viewBox past the 100MP canvas budget started
  // throwing. An SVG is resolution-independent, so it is scaled to fit instead.
  test('a viewBox larger than the 100MP budget is scaled down, not rejected', async ({ page }) => {
    await page.goto('/svg-to-png');
    await page.locator('#file-input').setInputFiles(fixture('huge-viewbox.svg'));
    await expect(page.locator('.file-item').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.file-item.done').first()).toBeVisible({ timeout: 90000 });
    await expect(page.locator('.file-item').first()).not.toContainText(/too large/i);
  });
});
