import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('Expected PNG input');
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function gifInfo(buffer) {
  if (buffer.length < 13 || buffer.subarray(0, 6).toString('ascii') !== 'GIF89a') {
    throw new Error('Expected GIF89a output');
  }

  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  const packed = buffer[10];
  let pos = 13;
  if (packed & 0x80) pos += 3 * (1 << ((packed & 0x07) + 1));

  let frames = 0;
  const graphicControls = [];
  const skipSubBlocks = () => {
    while (pos < buffer.length) {
      const size = buffer[pos++];
      if (size === 0) return;
      pos += size;
    }
    throw new Error('Truncated GIF sub-blocks');
  };

  while (pos < buffer.length) {
    const marker = buffer[pos++];
    if (marker === 0x3b) break;

    if (marker === 0x21) {
      const label = buffer[pos++];
      if (label === 0xf9) {
        if (buffer[pos++] !== 4 || pos + 5 > buffer.length) {
          throw new Error('Malformed GIF graphic control extension');
        }
        const control = buffer[pos++];
        const delayCs = buffer.readUInt16LE(pos);
        pos += 2;
        const transparentIndex = buffer[pos++];
        if (buffer[pos++] !== 0) throw new Error('Malformed GIF graphic control terminator');
        graphicControls.push({
          transparent: Boolean(control & 0x01),
          disposal: (control >> 2) & 0x07,
          delayCs,
          transparentIndex,
        });
      } else {
        skipSubBlocks();
      }
      continue;
    }

    if (marker === 0x2c) {
      frames += 1;
      if (pos + 9 > buffer.length) throw new Error('Truncated GIF image descriptor');
      const localPacked = buffer[pos + 8];
      pos += 9;
      if (localPacked & 0x80) pos += 3 * (1 << ((localPacked & 0x07) + 1));
      pos += 1; // LZW minimum code size
      skipSubBlocks();
      continue;
    }

    throw new Error(`Unexpected GIF marker 0x${marker.toString(16)}`);
  }

  return { width, height, frames, graphicControls };
}

async function downloadGif(page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#dl-gif').click(),
  ]);
  return {
    name: download.suggestedFilename(),
    bytes: await readFile(await download.path()),
  };
}

test.describe('Images to GIF frame fidelity', () => {
  test('fits a differently shaped frame instead of stretching it', async ({ page }) => {
    const landscape = await readFile(fixture('landscape.png'));
    const portrait = await readFile(fixture('portrait.png'));
    const first = pngDimensions(landscape);
    const second = pngDimensions(portrait);

    await page.addInitScript(() => {
      window.__irisGifDrawCalls = [];
      const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (...args) {
        const source = args[0];
        if (args.length === 5 && source && Number.isFinite(source.width) && Number.isFinite(source.height)) {
          window.__irisGifDrawCalls.push({
            sourceWidth: source.width,
            sourceHeight: source.height,
            x: args[1],
            y: args[2],
            width: args[3],
            height: args[4],
          });
        }
        return originalDrawImage.apply(this, args);
      };
    });

    await page.goto('/images-to-gif');
    await page.locator('#file-input').setInputFiles([
      fixture('landscape.png'),
      fixture('portrait.png'),
    ]);
    await page.locator('.frame-item').nth(1).waitFor({ timeout: 5000 });
    await page.locator('#delay-slider').fill('200');
    await page.locator('#delay-slider').dispatchEvent('input');
    await page.locator('#convert-btn').click();
    await page.locator('#dl-gif').waitFor({ timeout: 30000 });

    const outputScale = Math.min(1, 640 / first.width);
    const outputWidth = Math.max(1, Math.round(first.width * outputScale));
    const outputHeight = Math.max(1, Math.round(first.height * outputScale));
    const fit = Math.min(outputWidth / second.width, outputHeight / second.height);
    const expectedWidth = Math.max(1, Math.round(second.width * fit));
    const expectedHeight = Math.max(1, Math.round(second.height * fit));
    const expectedX = Math.round((outputWidth - expectedWidth) / 2);
    const expectedY = Math.round((outputHeight - expectedHeight) / 2);

    const draws = await page.evaluate(() => window.__irisGifDrawCalls);
    const portraitDraws = draws.filter(draw =>
      draw.sourceWidth === second.width && draw.sourceHeight === second.height
    );
    expect(portraitDraws.length).toBeGreaterThanOrEqual(2);
    for (const draw of portraitDraws) {
      expect(draw).toMatchObject({
        x: expectedX,
        y: expectedY,
        width: expectedWidth,
        height: expectedHeight,
      });
    }

    const output = await downloadGif(page);
    expect(output.name).toBe('animation.gif');
    const info = gifInfo(output.bytes);
    expect(info.width).toBe(outputWidth);
    expect(info.height).toBe(outputHeight);
    expect(info.frames).toBe(2);
    expect(info.graphicControls).toHaveLength(2);
    expect(info.graphicControls.every(control => control.delayCs === 20)).toBe(true);
    expect(info.graphicControls.every(control => control.transparent)).toBe(true);
    expect(info.graphicControls.every(control => control.disposal === 2)).toBe(true);
  });

  test('keeps source transparency in the downloaded GIF', async ({ page }) => {
    await page.goto('/images-to-gif');
    await page.locator('#file-input').setInputFiles([
      fixture('transparent.png'),
      fixture('transparent.png'),
    ]);
    await page.locator('.frame-item').nth(1).waitFor({ timeout: 5000 });
    await page.locator('#convert-btn').click();
    await page.locator('#dl-gif').waitFor({ timeout: 30000 });

    const output = await downloadGif(page);
    const info = gifInfo(output.bytes);
    expect(info.frames).toBe(2);
    expect(info.graphicControls).toHaveLength(2);
    expect(info.graphicControls.every(control => control.transparent)).toBe(true);
  });
});
