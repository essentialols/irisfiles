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

// Built in-page rather than committed as a fixture: `.vercelignore` keeps
// test/ out of the deploy, so a fetched fixture only exists locally. The
// committed transparent.png is alpha 128 everywhere, which is opaque under
// one-bit GIF transparency and so cannot exercise this path at all.
async function buildPng(page, { width, height, background, square }) {
  const base64 = await page.evaluate(async spec => {
    const canvas = document.createElement('canvas');
    canvas.width = spec.width;
    canvas.height = spec.height;
    const ctx = canvas.getContext('2d');
    if (spec.background) {
      ctx.fillStyle = spec.background;
      ctx.fillRect(0, 0, spec.width, spec.height);
    }
    ctx.fillStyle = spec.square;
    ctx.fillRect(spec.width / 4, spec.height / 4, spec.width / 2, spec.height / 2);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }, { width, height, background, square });
  return Buffer.from(base64, 'base64');
}

// Decode the GIF the browser way. Header flags alone cannot tell a correct
// palette from one with an opaque colour punched out of it.
async function firstFramePixels(page, bytes, points) {
  return page.evaluate(async ({ base64, samples }) => {
    const binary = atob(base64);
    const gif = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) gif[i] = binary.charCodeAt(i);
    const bitmap = await createImageBitmap(new Blob([gif], { type: 'image/gif' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    return samples.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
  }, { base64: bytes.toString('base64'), samples: points });
}

function expectColorNear(actual, expected, tolerance = 16) {
  expect(actual[3]).toBe(255);
  for (let channel = 0; channel < 3; channel++) {
    expect(Math.abs(actual[channel] - expected[channel])).toBeLessThanOrEqual(tolerance);
  }
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
    const first = await buildPng(page, { width: 100, height: 100, square: '#ff0000' });
    const second = await buildPng(page, { width: 100, height: 100, square: '#0000ff' });
    await page.locator('#file-input').setInputFiles([
      { name: 'transparent-a.png', mimeType: 'image/png', buffer: first },
      { name: 'transparent-b.png', mimeType: 'image/png', buffer: second },
    ]);
    await page.locator('.frame-item').nth(1).waitFor({ timeout: 5000 });
    await page.locator('#convert-btn').click();
    await page.locator('#dl-gif').waitFor({ timeout: 30000 });

    const output = await downloadGif(page);
    const info = gifInfo(output.bytes);
    expect(info.frames).toBe(2);
    expect(info.graphicControls).toHaveLength(2);
    expect(info.graphicControls.every(control => control.transparent)).toBe(true);

    const [centre, corner] = await firstFramePixels(page, output.bytes, [[50, 50], [2, 2]]);
    expectColorNear(centre, [255, 0, 0]);
    expect(corner[3]).toBe(0);
  });

  test('leaves a fully opaque batch opaque and unseamed', async ({ page }) => {
    await page.goto('/images-to-gif');
    // 900x300 downscales to 640x213, where width and height round apart. The
    // frame defining the canvas must still fill it edge to edge.
    const first = await buildPng(page, { width: 900, height: 300, background: '#1155aa', square: '#ffcc00' });
    const second = await buildPng(page, { width: 900, height: 300, background: '#1155aa', square: '#cc2200' });
    await page.locator('#file-input').setInputFiles([
      { name: 'opaque-a.png', mimeType: 'image/png', buffer: first },
      { name: 'opaque-b.png', mimeType: 'image/png', buffer: second },
    ]);
    await page.locator('.frame-item').nth(1).waitFor({ timeout: 5000 });
    await page.locator('#convert-btn').click();
    await page.locator('#dl-gif').waitFor({ timeout: 30000 });

    const output = await downloadGif(page);
    const info = gifInfo(output.bytes);
    expect(info.width).toBe(640);
    expect(info.height).toBe(213);
    expect(info.graphicControls).toHaveLength(2);
    expect(info.graphicControls.some(control => control.transparent)).toBe(false);
    expect(info.graphicControls.every(control => control.disposal === 0)).toBe(true);

    const [leftEdge, centre] = await firstFramePixels(page, output.bytes, [[0, 106], [320, 106]]);
    expectColorNear(leftEdge, [0x11, 0x55, 0xaa]);
    expectColorNear(centre, [0xff, 0xcc, 0x00]);
  });
});
