import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

function isoBmff(majorBrand, compatibleBrands = []) {
  const size = 16 + compatibleBrands.length * 4;
  const bytes = Buffer.alloc(size);
  bytes.writeUInt32BE(size, 0);
  bytes.write('ftyp', 4, 'ascii');
  bytes.write(majorBrand, 8, 'ascii');
  compatibleBrands.forEach((brand, index) => bytes.write(brand, 16 + index * 4, 'ascii'));
  return bytes;
}

function ebml(docType) {
  const value = Buffer.from(docType, 'ascii');
  const payloadSize = 3 + value.length;
  return Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80 | payloadSize, 0x42, 0x82, 0x80 | value.length]),
    value,
  ]);
}

async function dropBytes(page, buffer) {
  await page.goto('/');
  await page.locator('#smart-file-input').setInputFiles({
    name: 'unknown.bin',
    mimeType: 'application/octet-stream',
    buffer,
  });
  await expect(page.locator('.route-format-badge')).toBeVisible();
}

test.describe('Smart Drop container detection', () => {
  test('uses compatible brands to distinguish AVIF from HEIC', async ({ page }) => {
    await dropBytes(page, isoBmff('mif1', ['avif']));
    await expect(page.locator('.route-format-badge')).toHaveText('AVIF');
    await expect(page.getByRole('button', { name: 'JPG', exact: true })).toBeVisible();
  });

  test('routes M4A brands to audio conversions', async ({ page }) => {
    await dropBytes(page, isoBmff('M4A '));
    await expect(page.locator('.route-format-badge')).toHaveText('M4A');
    await expect(page.getByRole('button', { name: 'WAV', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'WebM', exact: true })).toHaveCount(0);
  });

  test('routes QuickTime brands to MOV conversions', async ({ page }) => {
    await dropBytes(page, isoBmff('qt  '));
    await expect(page.locator('.route-format-badge')).toHaveText('MOV');
    await expect(page.getByRole('button', { name: 'MP4', exact: true })).toBeVisible();
  });

  test('uses the EBML document type to distinguish MKV from WebM', async ({ page }) => {
    await dropBytes(page, ebml('matroska'));
    await expect(page.locator('.route-format-badge')).toHaveText('MKV');
    await expect(page.getByRole('button', { name: 'WebM', exact: true })).toBeVisible();

    await dropBytes(page, ebml('webm'));
    await expect(page.locator('.route-format-badge')).toHaveText('WebM');
    await expect(page.getByRole('button', { name: 'MP4', exact: true })).toBeVisible();
  });
});

test('Smart Drop emits GIF bytes for an image-to-GIF conversion', async ({ page }) => {
  await page.goto('/');
  await page.locator('#smart-file-input').setInputFiles(fixture('sample.png'));
  await page.getByRole('button', { name: 'GIF', exact: true }).click();
  await page.getByRole('button', { name: 'Convert to GIF', exact: true }).click();

  const downloadButton = page.getByRole('button', { name: /^Download .*\.gif/ });
  await expect(downloadButton).toBeVisible({ timeout: 15_000 });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    downloadButton.click(),
  ]);
  const bytes = await readFile(await download.path());
  expect(download.suggestedFilename()).toMatch(/\.gif$/);
  expect(bytes.subarray(0, 6).toString('ascii')).toBe('GIF89a');
});
