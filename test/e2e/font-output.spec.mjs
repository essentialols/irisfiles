import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

async function convertAndDownload(page, path, fixtureName, expectedExtension) {
  const automaticDownloads = [];
  page.on('download', download => automaticDownloads.push(download));

  await page.goto(path);
  await page.locator('#file-input').setInputFiles(fixture(fixtureName));
  await expect(page.locator('#action-btn')).toBeVisible();
  await page.locator('#action-btn').click();
  await expect(page.locator('#font-results .file-item.done')).toBeVisible({ timeout: 30_000 });

  // Conversion should prepare a result, not trigger opentype.js's own browser download.
  expect(automaticDownloads).toHaveLength(0);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#font-results .dl-btn').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${expectedExtension}$`, 'i'));

  const outputPath = await download.path();
  expect(outputPath).toBeTruthy();
  const output = await readFile(outputPath);
  expect(output.length).toBeGreaterThan(1_000);
  return output;
}

async function expectBrowserLoadsFont(page, output) {
  const status = await page.evaluate(async bytes => {
    const face = new FontFace('IrisFilesOutputVerification', new Uint8Array(bytes).buffer);
    await face.load();
    return face.status;
  }, Array.from(output));
  expect(status).toBe('loaded');
}

function sfntChecksum(output) {
  expect(output.length % 4).toBe(0);
  let checksum = 0;
  for (let offset = 0; offset < output.length; offset += 4) {
    checksum = (checksum + output.readUInt32BE(offset)) >>> 0;
  }
  return checksum;
}

async function expectRefusal(page, path, fixtureName, message) {
  const downloads = [];
  page.on('download', download => downloads.push(download));

  await page.goto(path);
  await page.locator('#file-input').setInputFiles(fixture(fixtureName));
  await page.locator('#action-btn').click();

  const notice = page.locator('#font-results .notice');
  await expect(notice).toBeVisible({ timeout: 30_000 });
  await expect(notice).toContainText(message);
  await expect(notice).toContainText('no file was created');
  expect(downloads).toHaveLength(0);
  await expect(page.locator('#font-results .dl-btn')).toHaveCount(0);
}

test.describe('font conversion output', () => {
  async function delayFirstFontRead(page) {
    await page.addInitScript(() => {
      const originalArrayBuffer = Blob.prototype.arrayBuffer;
      let release;
      let delayed = false;
      window.__fontReadStarted = false;
      window.__releaseFontRead = () => { if (release) release(); };
      Blob.prototype.arrayBuffer = async function() {
        if (!delayed && this instanceof File) {
          delayed = true;
          window.__fontReadStarted = true;
          await new Promise(resolve => { release = resolve; });
        }
        return originalArrayBuffer.call(this);
      };
    });
  }

  async function waitForDelayedFontRead(page) {
    await expect.poll(() => page.evaluate(() => window.__fontReadStarted)).toBe(true);
  }

  async function releaseDelayedFontRead(page) {
    await page.evaluate(() => window.__releaseFontRead());
    await expect(page.locator('#action-btn')).toHaveText('Convert to WOFF');
  }

  // WOFF only wraps an sfnt, so these stay lossless and never re-encode outlines.
  test('TTF to WOFF wraps the original sfnt into a browser-loadable WOFF', async ({ page }) => {
    const output = await convertAndDownload(page, '/ttf-to-woff', 'sample.ttf', 'woff');
    expect(Array.from(output.subarray(0, 4))).toEqual([0x77, 0x4f, 0x46, 0x46]); // wOFF
    expect(output.readUInt32BE(4)).toBe(0x00010000); // preserves TrueType flavor
    await expectBrowserLoadsFont(page, output);
  });

  test('OTF to WOFF wraps the original sfnt into a browser-loadable WOFF', async ({ page }) => {
    const output = await convertAndDownload(page, '/otf-to-woff', 'sample.otf', 'woff');
    expect(Array.from(output.subarray(0, 4))).toEqual([0x77, 0x4f, 0x46, 0x46]); // wOFF
    expect(output.readUInt32BE(4)).toBe(0x4f54544f); // preserves OTTO flavor
    await expectBrowserLoadsFont(page, output);
  });

  test('WOFF to TTF unwraps the container back to a browser-loadable TrueType font', async ({ page }) => {
    const output = await convertAndDownload(page, '/woff-to-ttf', 'sample.woff', 'ttf');
    expect(output.readUInt32BE(0)).toBe(0x00010000);
    expect(sfntChecksum(output)).toBe(0xB1B0AFBA);
    await expectBrowserLoadsFont(page, output);
  });

  // TTF and OTF name different outline formats, so these need a real re-encode.
  // opentype.js cannot rebuild every table it can read; refuse rather than emit
  // a truncated font.
  test('TTF to OTF reports the fonts whose outlines cannot be rebuilt', async ({ page }) => {
    await expectRefusal(page, '/ttf-to-otf', 'sample.ttf', 'cannot rebuild');
  });

  test('WOFF to OTF reports the fonts whose outlines cannot be rebuilt', async ({ page }) => {
    await expectRefusal(page, '/woff-to-otf', 'sample.woff', 'cannot rebuild');
  });

  test('OTF to TTF refuses CFF before loading a serializer that cannot make TrueType outlines', async ({ page }) => {
    const opentypeRequests = [];
    page.on('request', request => {
      if (request.url().includes('opentype.js')) opentypeRequests.push(request.url());
    });

    await page.goto('/otf-to-ttf');
    await expect(page.locator('.notice[data-kind="info"]')).toContainText('many OTF files use CFF outlines');
    await page.locator('#file-input').setInputFiles(fixture('sample.otf'));
    await page.locator('#action-btn').click();

    const notice = page.locator('#font-results .notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('CFF outlines');
    await expect(notice).toContainText('No file was created');
    await expect(page.locator('#font-results .dl-btn')).toHaveCount(0);
    expect(opentypeRequests).toHaveLength(0);
  });

  test('OTF to TTF still reports a truncated sfnt as corrupted rather than unsupported CFF', async ({ page }) => {
    const truncated = Buffer.alloc(32);
    truncated.write('OTTO', 0, 'ascii');
    truncated.writeUInt16BE(2, 4); // Two table records would require at least 44 bytes.

    await page.goto('/otf-to-ttf');
    await page.locator('#file-input').setInputFiles({
      name: 'truncated.otf',
      mimeType: 'font/otf',
      buffer: truncated,
    });
    await page.locator('#action-btn').click();

    const notice = page.locator('#font-results .notice');
    await expect(notice).toContainText('corrupted or unsupported');
    await expect(notice).not.toContainText('CFF outlines');
    await expect(page.locator('#font-results .dl-btn')).toHaveCount(0);
  });

  test('WOFF round-trips through TTF without losing tables', async ({ page }) => {
    const woff = await convertAndDownload(page, '/ttf-to-woff', 'sample.ttf', 'woff');
    const original = await readFile(fixture('sample.ttf'));
    // Same table count survives the wrap, so no table is dropped on the way in.
    expect(woff.readUInt16BE(12)).toBe(original.readUInt16BE(4));
  });

  test('a batch of two fonts shows a summary and downloads together as a ZIP', async ({ page }) => {
    await page.goto('/ttf-to-woff');
    await page.locator('#file-input').setInputFiles([fixture('sample.ttf'), fixture('sample.ttf')]);
    await page.locator('#action-btn').click();
    await expect(page.locator('#font-results .file-item.done')).toHaveCount(2, { timeout: 30_000 });
    await expect(page.locator('#font-results .batch-summary')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#dl-all-zip').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('irisfiles-fonts.zip');
    const outputPath = await download.path();
    expect(outputPath).toBeTruthy();
    expect((await readFile(outputPath)).length).toBeGreaterThan(1_000);
  });

  test('changing the queue after conversion removes downloads from the old queue', async ({ page }) => {
    await page.goto('/otf-to-woff');
    await page.locator('#file-input').setInputFiles(fixture('sample.otf'));
    await page.locator('#action-btn').click();
    await expect(page.locator('#font-results .file-item.done')).toHaveCount(1, { timeout: 30_000 });

    await page.locator('#file-input').setInputFiles(fixture('sample.otf'));
    await expect(page.locator('#file-list .file-item')).toHaveCount(2);
    await expect(page.locator('#font-results')).toHaveCount(0);
  });

  // Queue changes during conversion used to let the old snapshot publish after
  // the visible source list had already changed.
  test('removing a font during conversion cannot publish a result for the removed file', async ({ page }) => {
    await delayFirstFontRead(page);
    await page.goto('/otf-to-woff');
    await page.locator('#file-input').setInputFiles(fixture('sample.otf'));
    await page.locator('#action-btn').click();
    await waitForDelayedFontRead(page);

    await page.locator('#file-list .btn-remove').click();
    await expect(page.locator('#file-list .file-item')).toHaveCount(0);
    await releaseDelayedFontRead(page);

    await expect(page.locator('#font-results')).toHaveCount(0);
    await expect(page.locator('#action-btn')).not.toBeVisible();
  });

  test('adding a font during conversion discards the stale partial batch', async ({ page }) => {
    await delayFirstFontRead(page);
    await page.goto('/otf-to-woff');
    await page.locator('#file-input').setInputFiles(fixture('sample.otf'));
    await page.locator('#action-btn').click();
    await waitForDelayedFontRead(page);

    await page.locator('#file-input').setInputFiles(fixture('sample.otf'));
    await expect(page.locator('#file-list .file-item')).toHaveCount(2);
    await releaseDelayedFontRead(page);

    await expect(page.locator('#font-results')).toHaveCount(0);
    await expect(page.locator('#action-btn')).toBeEnabled();
  });

  // Regression guard for #164: a cleared batch used to leave the button
  // permanently disabled or mislabeled with a stale "Converting..." text.
  test('clearing after a completed batch leaves the button usable for a new conversion', async ({ page }) => {
    await page.goto('/ttf-to-woff');
    await page.locator('#file-input').setInputFiles(fixture('sample.ttf'));
    await page.locator('#action-btn').click();
    await expect(page.locator('#font-results .file-item.done')).toBeVisible({ timeout: 30_000 });

    await page.locator('#clear-all').click();
    await expect(page.locator('#file-list .file-item')).toHaveCount(0);
    await expect(page.locator('#font-results')).toHaveCount(0);
    await expect(page.locator('#action-btn')).not.toBeVisible();

    await page.locator('#file-input').setInputFiles(fixture('sample.ttf'));
    await expect(page.locator('#action-btn')).toBeEnabled();
    await expect(page.locator('#action-btn')).toHaveText('Convert to WOFF');

    await page.locator('#action-btn').click();
    await expect(page.locator('#font-results .file-item.done')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#action-btn')).toHaveText('Convert to WOFF');
  });
});
