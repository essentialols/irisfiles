import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

const EXIFREADER_URL = '**/exifreader@4.23.5/dist/exif-reader.js';
const PIEXIF_URL = '**/piexifjs@1.0.6/piexif.js';

async function downloadAfterStrip(page) {
  await page.locator('#strip-all').click();
  await page.locator('.btn-download').waitFor({ timeout: 10000 });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.btn-download').click(),
  ]);
  return download;
}

test.describe('Image Metadata regressions', () => {
  test('Strip All preserves a scan that starts with a stuffed FF byte', async ({ page }) => {
    const source = await readFile(fixture('sample.jpg'));
    const sos = source.indexOf(Buffer.from([0xff, 0xda]));
    const scanStart = sos + source.readUInt16BE(sos + 2) + 2;
    const input = Buffer.concat([
      source.subarray(0, scanStart),
      Buffer.from([0xff, 0x00]),
      source.subarray(scanStart),
    ]);

    await page.goto('/image-metadata');
    await page.locator('#file-input').setInputFiles({
      name: 'stuffed-byte.jpg',
      mimeType: 'image/jpeg',
      buffer: input,
    });
    await expect(page.locator('#strip-all')).toBeVisible({ timeout: 10000 });

    const download = await downloadAfterStrip(page);
    const output = await readFile(await download.path());
    expect(output.subarray(scanStart, scanStart + 2)).toEqual(Buffer.from([0xff, 0x00]));
    expect(output.subarray(scanStart)).toEqual(input.subarray(scanStart));
  });

  test('retries ExifReader after its first script load fails', async ({ page }) => {
    let requests = 0;
    await page.route(EXIFREADER_URL, async route => {
      requests++;
      if (requests === 1) await route.abort('failed');
      else await route.continue();
    });

    await page.goto('/image-metadata');
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await expect(page.locator('#exif-file .file-item__status')).toContainText('Error:', { timeout: 10000 });

    await page.locator('#file-input').setInputFiles(fixture('sample2.jpg'));
    await expect(page.locator('#exif-file .file-item__status')).toHaveText('Ready', { timeout: 10000 });
    expect(requests).toBe(2);
  });

  test('retries piexif after its first script load fails', async ({ page }) => {
    let requests = 0;
    await page.route(PIEXIF_URL, async route => {
      requests++;
      if (requests === 1) await route.abort('failed');
      else await route.continue();
    });

    await page.goto('/image-metadata');
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await expect(page.locator('#strip-gps')).toBeVisible({ timeout: 10000 });
    await page.locator('#strip-gps').click();
    await expect(page.locator('#exif-file .file-item__status')).toContainText('Error:', { timeout: 10000 });

    await page.locator('#strip-gps').click();
    await expect(page.locator('.btn-download')).toBeVisible({ timeout: 10000 });
    expect(requests).toBe(2);
  });

  test('names re-encoded BMP output with the returned JPEG type', async ({ page }) => {
    await page.goto('/image-metadata');
    await page.locator('#file-input').setInputFiles(fixture('sample.bmp'));
    await expect(page.locator('#strip-all')).toBeVisible({ timeout: 10000 });

    const download = await downloadAfterStrip(page);
    expect(download.suggestedFilename()).toBe('sample-clean.jpg');
    const output = await readFile(await download.path());
    expect(output.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  test('ignores metadata from an older in-flight selection', async ({ page }) => {
    await page.route(EXIFREADER_URL, route => route.fulfill({
      contentType: 'application/javascript',
      body: `window.ExifReader = { load(buffer) {
        const bytes = new Uint8Array(buffer);
        const width = bytes[0] === 0xff && bytes[1] === 0xd8 ? 111 : 222;
        return { file: { 'Image Width': { description: width } } };
      } };`,
    }));
    await page.addInitScript(() => {
      const arrayBuffer = File.prototype.arrayBuffer;
      let releaseFirst;
      File.prototype.arrayBuffer = function () {
        if (this.name !== 'sample.jpg') return arrayBuffer.call(this);
        window.firstMetadataReadStarted = true;
        return new Promise(resolve => {
          releaseFirst = () => arrayBuffer.call(this).then(resolve);
        });
      };
      window.releaseFirstMetadataRead = () => releaseFirst();
    });

    await page.goto('/image-metadata');
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await expect.poll(() => page.evaluate(() => window.firstMetadataReadStarted)).toBe(true);

    await page.locator('#file-input').setInputFiles(fixture('sample.png'));
    await expect(page.locator('#exif-file .file-item__status')).toHaveText('Ready', { timeout: 10000 });
    await page.evaluate(() => window.releaseFirstMetadataRead());

    const width = page.locator('.meta-row', { hasText: 'Width' }).locator('.meta-value');
    await expect(width).toHaveText('222');
    await expect(page.locator('#exif-file .file-item__name')).toHaveText('sample.png');
    await expect(page.locator('#save-changes')).toBeHidden();
    await expect(page.locator('.meta-notice').last()).toContainText('Non-JPEG format');
  });
});
