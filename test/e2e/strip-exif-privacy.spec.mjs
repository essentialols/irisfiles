import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

function gifFrameCount(buffer) {
  let pos = 13;
  const packed = buffer[10];
  if (packed & 0x80) pos += 3 * (1 << ((packed & 0x07) + 1));
  let frames = 0;
  const skipSubBlocks = () => {
    while (pos < buffer.length) {
      const size = buffer[pos++];
      if (size === 0) return;
      pos += size;
    }
    throw new Error('Truncated GIF');
  };
  while (pos < buffer.length) {
    const marker = buffer[pos++];
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      pos += 1;
      skipSubBlocks();
      continue;
    }
    if (marker === 0x2c) {
      frames += 1;
      if (pos + 9 > buffer.length) throw new Error('Truncated GIF image descriptor');
      const localPacked = buffer[pos + 8];
      pos += 9;
      if (localPacked & 0x80) pos += 3 * (1 << ((localPacked & 0x07) + 1));
      pos += 1;
      skipSubBlocks();
      continue;
    }
    throw new Error(`Unexpected GIF marker 0x${marker.toString(16)}`);
  }
  return frames;
}

function addPrivateGifMetadata(buffer) {
  const trailer = buffer.lastIndexOf(0x3b);
  if (trailer < 0) throw new Error('GIF trailer not found');

  const appId = Buffer.from('GPSMETA1.0X', 'ascii');
  const payload = Buffer.from('location=37.7749,-122.4194;owner=Resume-JP', 'utf8');
  const applicationExtension = Buffer.concat([
    Buffer.from([0x21, 0xff, 0x0b]),
    appId,
    Buffer.from([payload.length]),
    payload,
    Buffer.from([0]),
  ]);
  const trailing = Buffer.from('POST-TRAILER-LOCATION=35.6586,139.7454', 'utf8');

  return {
    appId,
    payload,
    trailing,
    buffer: Buffer.concat([
      buffer.subarray(0, trailer),
      applicationExtension,
      buffer.subarray(trailer, trailer + 1),
      trailing,
    ]),
  };
}

test.describe('Strip EXIF privacy regressions', () => {
  test('removes GIF application metadata and bytes after the trailer without changing animation', async ({ page }) => {
    const source = await readFile(fixture('animated.gif'));
    const tagged = addPrivateGifMetadata(source);
    expect(tagged.buffer.includes(Buffer.from('NETSCAPE2.0'))).toBe(true);

    await page.goto('/strip-exif');
    await page.locator('#file-input').setInputFiles({
      name: 'Resume_日本語_private.gif',
      mimeType: 'image/gif',
      buffer: tagged.buffer,
    });
    await page.locator('.file-item.done').waitFor({ timeout: 10000 });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.btn-download').click(),
    ]);
    const output = await readFile(await download.path());

    expect(download.suggestedFilename()).toBe('Resume_日本語_private-clean.gif');
    expect(output.at(-1)).toBe(0x3b);
    expect(output.includes(tagged.appId)).toBe(false);
    expect(output.includes(tagged.payload)).toBe(false);
    expect(output.includes(tagged.trailing)).toBe(false);
    expect(output.includes(Buffer.from('NETSCAPE2.0'))).toBe(true);
    expect(gifFrameCount(output)).toBe(gifFrameCount(tagged.buffer));
  });
});
