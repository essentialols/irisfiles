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

function webpChunkTypes(buffer) {
  const types = [];
  for (let pos = 12; pos + 8 <= buffer.length;) {
    const size = buffer.readUInt32LE(pos + 4);
    types.push(buffer.toString('latin1', pos, pos + 4));
    pos += 8 + size + (size & 1);
  }
  return types;
}

function addPrivateWebpChunks(buffer) {
  const payload = Buffer.from('private-webp-secret');
  const chunk = (type, data) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 'latin1');
    header.writeUInt32LE(data.length, 4);
    return Buffer.concat([header, data, Buffer.alloc(data.length & 1)]);
  };
  const out = Buffer.concat([buffer, chunk('PRIV', payload), chunk('EXIF', payload)]);
  out.writeUInt32LE(out.length - 8, 4);
  return { payload, buffer: out };
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

  test('removes unknown WebP chunks and keeps the animation decodable', async ({ page }) => {
    const source = await readFile(fixture('animated.webp'));
    const tagged = addPrivateWebpChunks(source);
    expect(tagged.buffer.includes(tagged.payload)).toBe(true);

    await page.goto('/strip-exif');
    await page.locator('#file-input').setInputFiles({
      name: 'private.webp',
      mimeType: 'image/webp',
      buffer: tagged.buffer,
    });
    await page.locator('.file-item.done').waitFor({ timeout: 10000 });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.btn-download').click(),
    ]);
    const output = await readFile(await download.path());

    expect(output.includes(tagged.payload)).toBe(false);
    const kept = webpChunkTypes(output);
    expect(kept).not.toContain('PRIV');
    expect(kept).not.toContain('EXIF');
    expect(kept.filter((t) => t === 'ANMF')).toHaveLength(webpChunkTypes(source).filter((t) => t === 'ANMF').length);
    expect(output.readUInt32LE(4)).toBe(output.length - 8);
    const size = await page.evaluate(async (bytes) => {
      const bmp = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/webp' }));
      return [bmp.width, bmp.height];
    }, [...output]);
    expect(size[0]).toBeGreaterThan(0);
  });
});
