import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

const EXIFREADER_URL = '**/exifreader@4.23.5/dist/exif-reader.js';
const PIEXIF_URL = '**/piexifjs@1.0.6/piexif.js';
const XMP_HEADER = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'ascii');
const XMP_EXTENDED_HEADER = Buffer.from('http://ns.adobe.com/xmp/extension/\0', 'ascii');

function app1Segment(payload) {
  if (payload.length + 2 > 0xffff) throw new Error('APP1 payload too large');
  const segment = Buffer.alloc(4 + payload.length);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment.writeUInt16BE(payload.length + 2, 2);
  payload.copy(segment, 4);
  return segment;
}

function injectApp1(jpeg, payload) {
  return Buffer.concat([jpeg.subarray(0, 2), app1Segment(payload), jpeg.subarray(2)]);
}

function scanPayload(jpeg) {
  let pos = 2;
  while (pos + 4 <= jpeg.length) {
    if (jpeg[pos] !== 0xff) throw new Error('invalid JPEG marker');
    const marker = jpeg[pos + 1];
    if (marker === 0xda) {
      const length = jpeg.readUInt16BE(pos + 2);
      return jpeg.subarray(pos + 2 + length);
    }
    if (marker === 0xd9) return Buffer.alloc(0);
    const length = jpeg.readUInt16BE(pos + 2);
    pos += 2 + length;
  }
  throw new Error('JPEG has no scan');
}

async function downloadAfterStrip(page) {
  await page.locator('#strip-all').click();
  await page.locator('.btn-download').waitFor({ timeout: 10000 });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.btn-download').click(),
  ]);
  return download;
}

async function downloadAfterGpsStrip(page) {
  await page.locator('#strip-gps').click();
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

  test('Strip GPS removes XMP coordinates and location names while preserving pixels and unrelated XMP', async ({ page }) => {
    const source = await readFile(fixture('sample.jpg'));
    const xmp = Buffer.from(`<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
   xmlns:exif="http://ns.adobe.com/exif/1.0/"
   xmlns:xmp="http://ns.adobe.com/xap/1.0/"
   xmlns:dc="http://purl.org/dc/elements/1.1/"
   xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
   xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"
   exif:GPSLatitude="37,46.494N"
   exif:GPSLongitude="122,25.164W"
   exif:GPSAltitude="18/1"
   photoshop:City="San Francisco"
   Iptc4xmpCore:Location="Bernal Heights"
   xmp:CreateDate="2026-09-20T00:14:46-07:00">
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">Keep this résumé 日本語 description</rdf:li></rdf:Alt></dc:description>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`, 'utf8');
    const input = injectApp1(source, Buffer.concat([XMP_HEADER, xmp]));

    await page.goto('/image-metadata');
    await page.locator('#file-input').setInputFiles({
      name: 'Résumé_日本語_xmp-location.jpg',
      mimeType: 'image/jpeg',
      buffer: input,
    });

    const gpsGroup = page.locator('.meta-group', { hasText: 'GPS Location' });
    await expect(gpsGroup).toContainText('37,46.494N', { timeout: 10000 });
    await expect(gpsGroup).toContainText('122,25.164W');

    const download = await downloadAfterGpsStrip(page);
    expect(download.suggestedFilename()).toBe('Résumé_日本語_xmp-location-clean.jpg');
    const output = await readFile(await download.path());
    const text = output.toString('utf8');

    expect(text).not.toContain('GPSLatitude');
    expect(text).not.toContain('GPSLongitude');
    expect(text).not.toContain('GPSAltitude');
    expect(text).not.toContain('San Francisco');
    expect(text).not.toContain('Bernal Heights');
    expect(text).toContain('CreateDate');
    expect(text).toContain('Keep this résumé 日本語 description');
    expect(scanPayload(output)).toEqual(scanPayload(input));
  });

  test('Strip GPS refuses extended XMP rather than claiming an unverifiable privacy cleanup', async ({ page }) => {
    const source = await readFile(fixture('sample.jpg'));
    const extended = Buffer.concat([
      XMP_EXTENDED_HEADER,
      Buffer.from('0123456789ABCDEF0123456789ABCDEFunsafe-location-payload', 'ascii'),
    ]);
    const input = injectApp1(source, extended);
    let piexifRequests = 0;
    page.on('request', request => {
      if (request.url().includes('piexifjs@1.0.6/piexif.js')) piexifRequests++;
    });

    await page.goto('/image-metadata');
    await page.locator('#file-input').setInputFiles({
      name: 'extended-xmp.jpg',
      mimeType: 'image/jpeg',
      buffer: input,
    });
    await expect(page.locator('#strip-gps')).toBeVisible({ timeout: 10000 });
    await page.locator('#strip-gps').click();

    await expect(page.locator('#exif-file .file-item__status')).toContainText('extended XMP metadata', { timeout: 10000 });
    await expect(page.locator('.btn-download')).toHaveCount(0);
    expect(piexifRequests).toBe(0);
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

  // The selectionToken guard deliberately skips cleanup belonging to a
  // superseded operation, so resetState() owns restoring the buttons it hides.
  // Without that they came back disabled and still labelled "Stripping...".
  test('the action buttons come back enabled and normally labelled after Clear', async ({ page }) => {
    await page.goto('/image-metadata');
    await page.locator('#file-input').setInputFiles(fixture('metadata-heavy.jpg'));
    await expect(page.locator('#strip-all')).toBeVisible({ timeout: 20000 });

    await page.locator('#strip-all').click();
    await page.locator('#clear-all').click();

    await page.locator('#file-input').setInputFiles(fixture('metadata-heavy.jpg'));
    await expect(page.locator('#strip-all')).toBeVisible({ timeout: 20000 });

    await expect(page.locator('#strip-all')).toBeEnabled();
    await expect(page.locator('#strip-all')).toHaveText('Strip All Metadata');
    await expect(page.locator('#save-changes')).toHaveText('Save Changes');
  });
});
