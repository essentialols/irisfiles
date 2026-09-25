import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

test.describe('AVIF pages', () => {




  test('avif-to-jpg wrong format shows error', async ({ page }) => {
    await page.goto('/avif-to-jpg');
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await page.locator('.file-item__status.error').first().waitFor({ timeout: 10000 });
  });




  test('avif-to-png explains high-bit-depth precision limits', async ({ page }) => {
    await page.goto('/avif-to-png');
    const note = page.locator('.avif-depth-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText('High-bit-depth / HDR AVIF');
    await expect(note).toContainText('8-bit');
  });

  test('avif-to-png converts the native fixture to a real PNG', async ({ page }) => {
    await page.goto('/avif-to-png');
    await page.locator('#file-input').setInputFiles(fixture('sample.avif'));
    await page.locator('.file-item.done').first().waitFor({ timeout: 15000 });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.btn-download').first().click(),
    ]);
    const bytes = await readFile(await download.path());
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  test('avif-to-png wrong format shows error', async ({ page }) => {
    await page.goto('/avif-to-png');
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await page.locator('.file-item__status.error').first().waitFor({ timeout: 10000 });
  });





});

test.describe('ICO pages', () => {

  test('ico-to-png falls back to a smaller valid frame when the largest frame is corrupt', async ({ page }) => {
    const source = await readFile(fixture('sample.ico'));
    const sourceView = new DataView(source.buffer, source.byteOffset, source.byteLength);
    const validEntryOffset = 6;
    const validWidth = source[validEntryOffset] || 256;
    const validHeight = source[validEntryOffset + 1] || 256;
    const validPlanes = sourceView.getUint16(validEntryOffset + 4, true);
    const validBitDepth = sourceView.getUint16(validEntryOffset + 6, true);
    const validLength = sourceView.getUint32(validEntryOffset + 8, true);
    const validDataOffset = sourceView.getUint32(validEntryOffset + 12, true);
    const validPayload = source.subarray(validDataOffset, validDataOffset + validLength);
    const corruptPayload = Buffer.from('not-a-decodable-icon-frame');

    const directory = Buffer.alloc(6 + 16 * 2);
    directory.writeUInt16LE(0, 0);
    directory.writeUInt16LE(1, 2);
    directory.writeUInt16LE(2, 4);

    const writeEntry = (offset, width, height, planes, bitDepth, length, dataOffset) => {
      directory[offset] = width === 256 ? 0 : width;
      directory[offset + 1] = height === 256 ? 0 : height;
      directory[offset + 2] = 0;
      directory[offset + 3] = 0;
      directory.writeUInt16LE(planes, offset + 4);
      directory.writeUInt16LE(bitDepth, offset + 6);
      directory.writeUInt32LE(length, offset + 8);
      directory.writeUInt32LE(dataOffset, offset + 12);
    };

    const payloadOffset = directory.length;
    writeEntry(6, 256, 256, 1, 32, corruptPayload.length, payloadOffset);
    writeEntry(22, validWidth, validHeight, validPlanes, validBitDepth, validPayload.length, payloadOffset + corruptPayload.length);
    const ico = Buffer.concat([directory, corruptPayload, validPayload]);

    await page.goto('/ico-to-png');
    await page.locator('#file-input').setInputFiles({
      name: 'Résumé_日本語-corrupt-largest.ico',
      mimeType: 'image/x-icon',
      buffer: ico,
    });
    await page.locator('.file-item.done').first().waitFor({ timeout: 15000 });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.btn-download').first().click(),
    ]);
    expect(download.suggestedFilename()).toBe('Résumé_日本語-corrupt-largest.png');

    const png = await readFile(await download.path());
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.readUInt32BE(16)).toBe(validWidth);
    expect(png.readUInt32BE(20)).toBe(validHeight);
  });

});

test.describe('TIFF pages', () => {





  test('warns about native TIFF browser support before upload', async ({ page }) => {
    await page.goto('/tiff-to-png');
    const badge = page.locator('#tiff-support-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('Safari supports TIFF natively');
    await expect(badge).toContainText('Chrome, Edge, and Firefox do not support TIFF natively');
  });


  test('recognizes a native TIFF and explains Chromium decode failure', async ({ page }) => {
    await page.goto('/tiff-to-png');
    await page.locator('#file-input').setInputFiles(fixture('sample.tiff'));
    const status = page.locator('.file-item__status.error').first();
    await expect(status).toBeVisible({ timeout: 15000 });
    await expect(status).toContainText('Could not decode TIFF');
    await expect(status).not.toContainText('Unrecognized image format');
  });




  test('tiff-to-pdf page loads correctly', async ({ page }) => {
    await page.goto('/tiff-to-pdf');
    await expect(page.locator('#drop-zone')).toBeVisible();
    await expect(page.locator('#tiff-support-badge')).toBeVisible();
  });


  test('tiff-to-pdf reports the same TIFF capability error', async ({ page }) => {
    await page.goto('/tiff-to-pdf');
    await page.locator('#file-input').setInputFiles(fixture('sample.tiff'));
    await page.locator('#action-btn').click();
    const notice = page.locator('#pdf-results .notice');
    await expect(notice).toBeVisible({ timeout: 15000 });
    await expect(notice).toContainText('Could not decode TIFF');
  });
});

test.describe('SVG pages (no fixture)', () => {










});

test.describe('PNG to GIF', () => {




  test('converts file and shows done', async ({ page }) => {
    await page.goto('/png-to-gif');
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));
    await page.locator('.file-item.done').first().waitFor({ timeout: 15000 });
    await expect(page.locator('.btn-download').first()).toBeVisible();
  });

  test('download produces correct extension', async ({ page }) => {
    await page.goto('/png-to-gif');
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));
    await page.locator('.file-item.done').first().waitFor({ timeout: 15000 });
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.btn-download').first().click(),
    ]);
    expect(dl.suggestedFilename()).toMatch(/\.gif$/);
  });

  test('wrong format shows error', async ({ page }) => {
    await page.goto('/png-to-gif');
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await page.locator('.file-item__status.error').first().waitFor({ timeout: 10000 });
  });
});

test.describe('JPG to GIF', () => {




  test('converts file and shows done', async ({ page }) => {
    await page.goto('/jpg-to-gif');
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await page.locator('.file-item.done').first().waitFor({ timeout: 15000 });
    await expect(page.locator('.btn-download').first()).toBeVisible();
  });

  test('download produces correct extension', async ({ page }) => {
    await page.goto('/jpg-to-gif');
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await page.locator('.file-item.done').first().waitFor({ timeout: 15000 });
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.btn-download').first().click(),
    ]);
    expect(dl.suggestedFilename()).toMatch(/\.gif$/);
  });

  test('wrong format shows error', async ({ page }) => {
    await page.goto('/jpg-to-gif');
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));
    await page.locator('.file-item__status.error').first().waitFor({ timeout: 10000 });
  });
});

test.describe('WebP to GIF', () => {




  test('converts file and shows done', async ({ page }) => {
    await page.goto('/webp-to-gif');
    await page.locator('#file-input').setInputFiles(fixture('sample.webp'));
    await page.locator('.file-item.done').first().waitFor({ timeout: 15000 });
    await expect(page.locator('.btn-download').first()).toBeVisible();
  });

  test('download produces correct extension', async ({ page }) => {
    await page.goto('/webp-to-gif');
    await page.locator('#file-input').setInputFiles(fixture('sample.webp'));
    await page.locator('.file-item.done').first().waitFor({ timeout: 15000 });
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.btn-download').first().click(),
    ]);
    expect(dl.suggestedFilename()).toMatch(/\.gif$/);
  });

  test('wrong format shows error', async ({ page }) => {
    await page.goto('/webp-to-gif');
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await page.locator('.file-item__status.error').first().waitFor({ timeout: 10000 });
  });
});

test.describe('GIF to WebP', () => {




  test('converts file and shows done', async ({ page }) => {
    await page.goto('/gif-to-webp');
    await page.locator('#file-input').setInputFiles(fixture('sample.gif'));
    await page.locator('.file-item.done').first().waitFor({ timeout: 15000 });
    await expect(page.locator('.btn-download').first()).toBeVisible();
  });

  test('download produces correct extension', async ({ page }) => {
    await page.goto('/gif-to-webp');
    await page.locator('#file-input').setInputFiles(fixture('sample.gif'));
    await page.locator('.file-item.done').first().waitFor({ timeout: 15000 });
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.btn-download').first().click(),
    ]);
    expect(dl.suggestedFilename()).toMatch(/\.webp$/);
  });

  test('wrong format shows error', async ({ page }) => {
    await page.goto('/gif-to-webp');
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await page.locator('.file-item__status.error').first().waitFor({ timeout: 10000 });
  });
});

test.describe('GIF to PDF', () => {



  test('converts file and shows done', async ({ page }) => {
    await page.goto('/gif-to-pdf');
    await page.locator('#file-input').setInputFiles(fixture('sample.gif'));
    await page.locator('#action-btn').click();
    await page.locator('.file-item.done').first().waitFor({ timeout: 15000 });
    await expect(page.locator('#dl-single').first()).toBeVisible();
  });

  test('download produces correct extension', async ({ page }) => {
    await page.goto('/gif-to-pdf');
    await page.locator('#file-input').setInputFiles(fixture('sample.gif'));
    await page.locator('#action-btn').click();
    await page.locator('.file-item.done').first().waitFor({ timeout: 15000 });
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#dl-single').first().click(),
    ]);
    expect(dl.suggestedFilename()).toMatch(/\.pdf$/);
  });

  test('accepts any image, not only gif', async ({ page }) => {
    // One img-to-pdf tool serves every *-to-pdf landing page, so a
    // different image is converted rather than rejected.
    await page.goto('/gif-to-pdf');
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await page.locator('#action-btn').click();
    await expect(page.locator('.file-item.done').first()).toBeVisible({ timeout: 20000 });
  });
});

test.describe('WebP to PDF', () => {



  test('converts file and shows done', async ({ page }) => {
    await page.goto('/webp-to-pdf');
    await page.locator('#file-input').setInputFiles(fixture('sample.webp'));
    await page.locator('#action-btn').click();
    await page.locator('.file-item.done').first().waitFor({ timeout: 15000 });
    await expect(page.locator('#dl-single').first()).toBeVisible();
  });

  test('download produces correct extension', async ({ page }) => {
    await page.goto('/webp-to-pdf');
    await page.locator('#file-input').setInputFiles(fixture('sample.webp'));
    await page.locator('#action-btn').click();
    await page.locator('.file-item.done').first().waitFor({ timeout: 15000 });
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#dl-single').first().click(),
    ]);
    expect(dl.suggestedFilename()).toMatch(/\.pdf$/);
  });

  test('accepts any image, not only webp', async ({ page }) => {
    // One img-to-pdf tool serves every *-to-pdf landing page, so a
    // different image is converted rather than rejected.
    await page.goto('/webp-to-pdf');
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await page.locator('#action-btn').click();
    await expect(page.locator('.file-item.done').first()).toBeVisible({ timeout: 20000 });
  });
});

test.describe('BMP to WebP', () => {




  test('converts file and shows done', async ({ page }) => {
    await page.goto('/bmp-to-webp');
    await page.locator('#file-input').setInputFiles(fixture('sample.bmp'));
    await page.locator('.file-item.done').first().waitFor({ timeout: 15000 });
    await expect(page.locator('.btn-download').first()).toBeVisible();
  });

  test('download produces correct extension', async ({ page }) => {
    await page.goto('/bmp-to-webp');
    await page.locator('#file-input').setInputFiles(fixture('sample.bmp'));
    await page.locator('.file-item.done').first().waitFor({ timeout: 15000 });
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.btn-download').first().click(),
    ]);
    expect(dl.suggestedFilename()).toMatch(/\.webp$/);
  });

  test('wrong format shows error', async ({ page }) => {
    await page.goto('/bmp-to-webp');
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await page.locator('.file-item__status.error').first().waitFor({ timeout: 10000 });
  });
});

test.describe('BMP to PDF', () => {



  test('converts file and shows done', async ({ page }) => {
    await page.goto('/bmp-to-pdf');
    await page.locator('#file-input').setInputFiles(fixture('sample.bmp'));
    await page.locator('#action-btn').click();
    await page.locator('.file-item.done').first().waitFor({ timeout: 15000 });
    await expect(page.locator('#dl-single').first()).toBeVisible();
  });

  test('download produces correct extension', async ({ page }) => {
    await page.goto('/bmp-to-pdf');
    await page.locator('#file-input').setInputFiles(fixture('sample.bmp'));
    await page.locator('#action-btn').click();
    await page.locator('.file-item.done').first().waitFor({ timeout: 15000 });
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#dl-single').first().click(),
    ]);
    expect(dl.suggestedFilename()).toMatch(/\.pdf$/);
  });

  test('accepts any image, not only bmp', async ({ page }) => {
    // One img-to-pdf tool serves every *-to-pdf landing page, so a
    // different image is converted rather than rejected.
    await page.goto('/bmp-to-pdf');
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await page.locator('#action-btn').click();
    await expect(page.locator('.file-item.done').first()).toBeVisible({ timeout: 20000 });
  });
});

test.describe('HEIC pages (no fixture)', () => {




  test('heic-to-jpg wrong format shows error', async ({ page }) => {
    await page.goto('/heic-to-jpg');
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await page.locator('.file-item__status.error').first().waitFor({ timeout: 10000 });
  });








});
