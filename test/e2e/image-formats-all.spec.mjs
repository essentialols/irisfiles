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

  // sample.ico's first directory entry is a valid 16x16 frame. Append a second
  // entry that claims 256x256 but points at garbage: the largest frame is corrupt.
  test('ico-to-png falls back to the next-largest frame when the largest is corrupt', async ({ page }) => {
    const src = await readFile(fixture('sample.ico'));
    const length = src.readUInt32LE(6 + 8);
    const offset = src.readUInt32LE(6 + 12);
    const header = Buffer.alloc(6 + 32);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(2, 4);
    const garbage = Buffer.from('not-a-decodable-icon-frame');
    header.writeUInt32LE(garbage.length, 6 + 8);         // entry 0: 256x256 (width/height 0), corrupt
    header.writeUInt32LE(header.length, 6 + 12);
    src.copy(header, 22, 6, 22);                         // entry 1: the valid 16x16 entry...
    header.writeUInt32LE(header.length + garbage.length, 22 + 12);  // ...repointed at the copied payload
    const ico = Buffer.concat([header, garbage, src.subarray(offset, offset + length)]);

    await page.goto('/ico-to-png');
    await page.locator('#file-input').setInputFiles({ name: 'damaged.ico', mimeType: 'image/x-icon', buffer: ico });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.btn-download').first().click({ timeout: 5000 }),
    ]);
    const png = await readFile(await download.path());
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([16, 16]);
  });

});

test.describe('TIFF pages', () => {
  test('converts a native TIFF to PNG in Chromium with the local fallback', async ({ page }) => {
    const requests = [];
    page.on('request', request => requests.push(request.url()));
    await page.goto('/tiff-to-png');
    await expect(page.locator('#tiff-support-badge')).toHaveCount(0);
    await page.locator('#file-input').setInputFiles(fixture('sample.tiff'));
    await page.locator('.file-item.done').first().waitFor({ timeout: 30_000 });
    await expect(page.locator('.file-item__status.error')).toHaveCount(0);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.btn-download').first().click()]);
    const data = await readFile(await download.path());
    expect([...data.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(data.readUInt32BE(16)).toBe(512);
    expect(data.readUInt32BE(20)).toBe(384);
    expect(requests.some(url => /\/js\/tiff-decoder\.js(?:$|\?)/.test(url))).toBe(true);
  });

  test('honors the TIFF orientation tag', async ({ page }) => {
    await page.goto('/tiff-to-png');
    await page.locator('#file-input').setInputFiles(fixture('sample-orientation6.tiff'));
    await page.locator('.file-item.done').first().waitFor({ timeout: 30_000 });
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.btn-download').first().click()]);
    const data = await readFile(await download.path());
    // Stored 8x4 with orientation 6 (rotate 90 CW) displays as 4x8.
    expect(data.readUInt32BE(16)).toBe(4);
    expect(data.readUInt32BE(20)).toBe(8);
  });

  test('tiff-to-pdf converts the same TIFF instead of showing a capability error', async ({ page }) => {
    await page.goto('/tiff-to-pdf');
    await expect(page.locator('#tiff-support-badge')).toHaveCount(0);
    await page.locator('#file-input').setInputFiles(fixture('sample.tiff'));
    await page.locator('#action-btn').click();
    await expect(page.locator('#pdf-results #dl-single')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#pdf-results .notice')).toHaveCount(0);
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
