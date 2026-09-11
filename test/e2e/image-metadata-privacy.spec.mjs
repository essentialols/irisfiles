import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

function jpegSegment(marker, payload) {
  const body = Buffer.from(payload);
  const length = body.length + 2;
  return Buffer.concat([Buffer.from([0xff, marker, length >> 8, length & 0xff]), body]);
}

function withPrivacyMetadata(jpeg) {
  const xmp = Buffer.from(
    'http://ns.adobe.com/xap/1.0/\0' +
    '<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/">' +
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
    'dc:title="PRIVATE HOME ADDRESS 123 TEST ST"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
  );
  const icc = Buffer.concat([
    Buffer.from('ICC_PROFILE\0', 'binary'),
    Buffer.from([1, 1]),
    Buffer.from('PRIVATE-ICC-DATA-TEST'.repeat(4)),
  ]);
  const iptc = Buffer.from('Photoshop 3.0\0PRIVATE-IPTC-DATA-TEST');
  const comment = Buffer.from('PRIVATE COMMENT: home=123 Test St');
  return Buffer.concat([
    jpeg.subarray(0, 2),
    jpegSegment(0xe1, xmp),
    jpegSegment(0xe2, icc),
    jpegSegment(0xed, iptc),
    jpegSegment(0xfe, comment),
    jpeg.subarray(2),
  ]);
}

function privacyMetadataMarkers(jpeg) {
  const markers = [];
  let pos = 2;
  while (pos + 4 <= jpeg.length && jpeg[pos] === 0xff) {
    while (pos < jpeg.length && jpeg[pos] === 0xff) pos++;
    if (pos >= jpeg.length) break;
    const marker = jpeg[pos++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (pos + 2 > jpeg.length) break;
    const length = jpeg.readUInt16BE(pos);
    if (length < 2 || pos + length > jpeg.length) break;
    const payload = jpeg.subarray(pos + 2, pos + length);
    if (marker === 0xe1 && payload.subarray(0, 6).equals(Buffer.from('Exif\0\0', 'binary'))) markers.push('EXIF');
    else if (marker === 0xe1 && payload.subarray(0, 29).toString('binary') === 'http://ns.adobe.com/xap/1.0/\0') markers.push('XMP');
    else if (marker === 0xe2 && payload.subarray(0, 12).toString('binary') === 'ICC_PROFILE\0') markers.push('ICC');
    else if (marker === 0xed) markers.push('IPTC/APP13');
    else if (marker === 0xfe) markers.push('COM');
    pos += length;
  }
  return markers;
}

function fromFirstScan(jpeg) {
  let pos = 2;
  while (pos + 4 <= jpeg.length && jpeg[pos] === 0xff) {
    const markerStart = pos;
    while (pos < jpeg.length && jpeg[pos] === 0xff) pos++;
    if (pos >= jpeg.length) break;
    const marker = jpeg[pos++];
    if (marker === 0xda || marker === 0xd9) return jpeg.subarray(markerStart);
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (pos + 2 > jpeg.length) break;
    const length = jpeg.readUInt16BE(pos);
    if (length < 2 || pos + length > jpeg.length) break;
    pos += length;
  }
  throw new Error('JPEG scan marker not found');
}

test.describe('Image Metadata privacy stripping', () => {
  test('Strip All removes EXIF, XMP, ICC, IPTC and comments without re-encoding pixels', async ({ page }) => {
    const source = await readFile(fixture('metadata-heavy.jpg'));
    const input = withPrivacyMetadata(source);
    expect(privacyMetadataMarkers(input)).toEqual(['XMP', 'ICC', 'IPTC/APP13', 'COM', 'EXIF']);

    await page.goto('/image-metadata');
    await page.locator('#file-input').setInputFiles({
      name: 'Résumé_日本語_private-metadata.jpg',
      mimeType: 'image/jpeg',
      buffer: input,
    });
    await page.locator('#metadata-panel').waitFor({ timeout: 10000 });
    await expect(page.locator('#strip-all')).toBeVisible();

    await page.locator('#strip-all').click();
    await page.locator('.btn-download').waitFor({ timeout: 10000 });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.btn-download').click(),
    ]);
    expect(download.suggestedFilename()).toBe('Résumé_日本語_private-metadata-clean.jpg');

    const output = await readFile(await download.path());
    expect(output.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(privacyMetadataMarkers(output)).toEqual([]);
    expect(output.includes(Buffer.from('PRIVATE HOME ADDRESS'))).toBe(false);
    expect(output.includes(Buffer.from('PRIVATE-IPTC-DATA-TEST'))).toBe(false);
    expect(output.includes(Buffer.from('PRIVATE COMMENT'))).toBe(false);
    expect(fromFirstScan(output)).toEqual(fromFirstScan(input));
  });
});
