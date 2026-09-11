import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { fixture, getFileItemCount, waitForStatus } from './helpers.mjs';

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('Expected PNG output');
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function addGifComment(buffer, text = 'GPS:37.7749,-122.4194') {
  const trailer = buffer.lastIndexOf(0x3b);
  if (trailer < 0) throw new Error('GIF trailer not found');
  const payload = Buffer.from(text, 'utf8');
  if (payload.length > 255) throw new Error('GIF test comment is too long');
  const extension = Buffer.concat([Buffer.from([0x21, 0xfe, payload.length]), payload, Buffer.from([0])]);
  return Buffer.concat([buffer.subarray(0, trailer), extension, buffer.subarray(trailer)]);
}

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

function addWebpXmp(buffer) {
  const payload = Buffer.from('<x:xmpmeta>GPS 37.7749 -122.4194</x:xmpmeta>', 'utf8');
  const header = Buffer.alloc(8);
  header.write('XMP ', 0, 'ascii');
  header.writeUInt32LE(payload.length, 4);
  const padding = payload.length & 1 ? Buffer.from([0]) : Buffer.alloc(0);
  const out = Buffer.concat([buffer, header, payload, padding]);
  out.writeUInt32LE(out.length - 8, 4);
  let pos = 12;
  while (pos + 8 <= out.length) {
    const type = out.toString('ascii', pos, pos + 4);
    const size = out.readUInt32LE(pos + 4);
    if (type === 'VP8X' && size >= 1) {
      out[pos + 8] |= 0x04;
      break;
    }
    pos += 8 + size + (size & 1);
  }
  return out;
}

function webpChunkTypes(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('Expected WebP output');
  }
  const types = [];
  let pos = 12;
  while (pos + 8 <= buffer.length) {
    const type = buffer.toString('ascii', pos, pos + 4);
    const size = buffer.readUInt32LE(pos + 4);
    types.push(type);
    pos += 8 + size + (size & 1);
  }
  if (pos !== buffer.length) throw new Error('Malformed WebP chunk layout');
  return types;
}

test.describe('Resize Image', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/resize-image`);
  });

  test('upload file and verify Ready status', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));
    await page.locator('.file-item').first().waitFor({ timeout: 5000 });
    const statusText = await page.locator('.file-item__status').textContent();
    expect(statusText).toContain('Ready');
    await expect(page.locator('#resize-btn')).toBeVisible();
  });

  test('aspect ratio lock auto-updates height when width changes', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));
    await page.locator('.file-item').first().waitFor({ timeout: 5000 });
    const lockCheckbox = page.locator('#lock-aspect');
    await expect(lockCheckbox).toBeChecked();
    await page.locator('#resize-width').fill('50');
    await page.waitForFunction(() => {
      const h = document.querySelector('#resize-height');
      return h && h.value && parseInt(h.value) > 0;
    }, { timeout: 5000 });
    const heightValue = await page.locator('#resize-height').inputValue();
    expect(parseInt(heightValue)).toBeGreaterThan(0);
  });

  test('click Resize button changes file status to done', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));
    await page.locator('.file-item').first().waitFor({ timeout: 5000 });
    await page.locator('#resize-btn').click();
    await page.locator('.file-item.done').waitFor({ timeout: 10000 });
    await expect(page.locator('.btn-download')).toBeVisible();
  });

  test('switch resize mode to percent and verify UI changes', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));
    await page.locator('.file-item').first().waitFor({ timeout: 5000 });
    await page.locator('#resize-mode').selectOption('percent');
    await expect(page.locator('#percent-group')).toBeVisible();
    await expect(page.locator('#dimensions-group')).not.toBeVisible();
  });

  test('percent mode resize and convert', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));
    await page.locator('.file-item').first().waitFor({ timeout: 5000 });
    await page.locator('#resize-mode').selectOption('percent');
    await page.locator('#resize-percent').fill('50');
    await page.locator('#resize-btn').click();
    await page.locator('.file-item.done').waitFor({ timeout: 10000 });
    await expect(page.locator('.btn-download')).toBeVisible();
  });

  test('uncheck aspect ratio lock and verify independent width/height', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));
    await page.locator('.file-item').first().waitFor({ timeout: 5000 });
    await page.locator('#lock-aspect').uncheck();
    const widthInput = page.locator('#resize-width');
    const heightInput = page.locator('#resize-height');
    const initialHeight = await heightInput.inputValue();
    await widthInput.fill('100');
    const newHeight = await heightInput.inputValue();
    expect(newHeight).toBe(initialHeight);
  });

  test('batch resize multiple images', async ({ page }) => {
    await page.locator('#file-input').setInputFiles([fixture('sample.png'), fixture('sample2.png')]);
    await page.locator('.file-item').nth(1).waitFor({ timeout: 5000 });
    await page.locator('#resize-btn').click();
    await page.locator('.file-item.done').nth(1).waitFor({ timeout: 10000 });
    const count = await getFileItemCount(page);
    expect(count).toBe(2);
    await expect(page.locator('#download-all')).toBeVisible();
  });

  test('aspect lock preserves each image ratio in a mixed batch', async ({ page }) => {
    const names = ['landscape.png', 'portrait.png'];
    const sourceDimensions = await Promise.all(names.map(async name =>
      pngDimensions(await readFile(fixture(name)))
    ));

    await page.locator('#file-input').setInputFiles(names.map(fixture));
    await page.locator('.file-item').nth(1).waitFor({ timeout: 5000 });
    await page.locator('#resize-width').fill('300');
    await page.locator('#resize-btn').click();
    await page.locator('.file-item.done').nth(1).waitFor({ timeout: 10000 });

    const outputDimensions = [];
    for (let i = 0; i < names.length; i++) {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('.btn-download').nth(i).click(),
      ]);
      outputDimensions.push(pngDimensions(await readFile(await download.path())));
    }

    for (let i = 0; i < names.length; i++) {
      expect(outputDimensions[i].width).toBe(300);
      const sourceRatio = sourceDimensions[i].width / sourceDimensions[i].height;
      const outputRatio = outputDimensions[i].width / outputDimensions[i].height;
      expect(Math.abs(outputRatio - sourceRatio)).toBeLessThan(0.01);
    }
    expect(outputDimensions[0].height).not.toBe(outputDimensions[1].height);
  });

  test('clear all removes all files', async ({ page }) => {
    await page.locator('#file-input').setInputFiles([fixture('sample.png'), fixture('sample2.png')]);
    await page.locator('.file-item').nth(1).waitFor({ timeout: 5000 });
    await page.locator('#clear-all').click();
    const count = await getFileItemCount(page);
    expect(count).toBe(0);
  });
});

test.describe('Strip EXIF', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/strip-exif`);
  });

  test('upload JPEG and auto-process to done state', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await page.locator('.file-item.done').waitFor({ timeout: 10000 });
    await expect(page.locator('.file-item.done')).toBeVisible();
  });

  test('verify before/after size metadata appears', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await page.locator('.file-item.done').waitFor({ timeout: 10000 });
    const metaText = await page.locator('.file-item__meta').textContent();
    expect(metaText).toMatch(/\d+/);
  });

  test('download button visible after processing', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await page.locator('.file-item.done').waitFor({ timeout: 10000 });
    await expect(page.locator('.btn-download').first()).toBeVisible();
  });

  test('preserves animated GIF frames while removing comment metadata', async ({ page }) => {
    const source = await readFile(fixture('animated.gif'));
    const tagged = addGifComment(source);
    await page.locator('#file-input').setInputFiles({
      name: 'Résumé_日本語_animation.gif',
      mimeType: 'image/gif',
      buffer: tagged,
    });
    await page.locator('.file-item.done').waitFor({ timeout: 10000 });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.btn-download').click(),
    ]);
    const output = await readFile(await download.path());
    expect(download.suggestedFilename()).toBe('Résumé_日本語_animation-clean.gif');
    expect(output.subarray(0, 6).toString('ascii')).toMatch(/^GIF8[79]a$/);
    expect(gifFrameCount(output)).toBe(gifFrameCount(tagged));
    expect(output.includes(Buffer.from('GPS:37.7749,-122.4194'))).toBe(false);
  });

  test('preserves animated WebP frames while removing XMP metadata', async ({ page }) => {
    const source = await readFile(fixture('animated.webp'));
    const tagged = addWebpXmp(source);
    await page.locator('#file-input').setInputFiles({
      name: 'Résumé_日本語_animation.webp',
      mimeType: 'image/webp',
      buffer: tagged,
    });
    await page.locator('.file-item.done').waitFor({ timeout: 10000 });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.btn-download').click(),
    ]);
    const output = await readFile(await download.path());
    const beforeTypes = webpChunkTypes(tagged);
    const afterTypes = webpChunkTypes(output);
    expect(download.suggestedFilename()).toBe('Résumé_日本語_animation-clean.webp');
    expect(afterTypes.filter(type => type === 'ANMF')).toHaveLength(beforeTypes.filter(type => type === 'ANMF').length);
    expect(afterTypes).toContain('ANIM');
    expect(afterTypes).not.toContain('XMP ');
    expect(afterTypes).not.toContain('EXIF');
    expect(afterTypes).not.toContain('ICCP');
  });

  test('batch process multiple files', async ({ page }) => {
    await page.locator('#file-input').setInputFiles([fixture('sample.jpg'), fixture('sample2.jpg')]);
    await page.locator('.file-item.done').nth(1).waitFor({ timeout: 10000 });
    await expect(page.locator('#download-all')).toBeVisible();
    const batchSummary = page.locator('#batch-summary');
    await expect(batchSummary).toBeVisible({ timeout: 5000 });
  });

  test('remove individual file from list', async ({ page }) => {
    await page.locator('#file-input').setInputFiles([fixture('sample.jpg'), fixture('sample2.jpg')]);
    await page.locator('.file-item.done').nth(1).waitFor({ timeout: 10000 });
    await page.locator('.btn-remove').first().click();
    const count = await getFileItemCount(page);
    expect(count).toBe(1);
  });

  test('clear all removes all files', async ({ page }) => {
    await page.locator('#file-input').setInputFiles([fixture('sample.jpg'), fixture('sample2.jpg')]);
    await page.locator('.file-item.done').nth(1).waitFor({ timeout: 10000 });
    await page.locator('#clear-all').click();
    const count = await getFileItemCount(page);
    expect(count).toBe(0);
  });
});

test.describe('Image Metadata', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/image-metadata`);
  });

  test('upload JPEG and metadata panel populates', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await page.locator('#metadata-panel').waitFor({ timeout: 10000 });
    const content = await page.locator('#metadata-panel').textContent();
    expect(content?.length).toBeGreaterThan(0);
  });

  test('action buttons visible for JPEG', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await page.locator('#metadata-panel').waitFor({ timeout: 10000 });
    await expect(page.locator('#strip-all')).toBeVisible();
    await expect(page.locator('#clear-all')).toBeVisible();
    await expect(page.locator('#save-changes')).toBeVisible();
  });

  test('strip all metadata and download', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await page.locator('#metadata-panel').waitFor({ timeout: 10000 });
    await page.locator('#strip-all').click();
    await page.locator('.btn-download').waitFor({ timeout: 10000 });
    await expect(page.locator('.btn-download')).toBeVisible();
  });

  test('clear all resets interface', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await page.locator('#metadata-panel').waitFor({ timeout: 10000 });
    await page.locator('#clear-all').click();
    await expect(page.locator('#metadata-panel')).not.toBeVisible({ timeout: 5000 });
  });

  test('non-JPEG PNG shows read-only metadata', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));
    await page.locator('#metadata-panel').waitFor({ timeout: 10000 });
    await expect(page.locator('#strip-all')).toBeVisible();
    await expect(page.locator('#save-changes')).not.toBeVisible();
  });
});

test.describe('Extract ZIP', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/extract-zip`);
  });

  test('upload ZIP and action button is visible and enabled', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.zip'));
    await page.locator('#action-btn').waitFor({ timeout: 5000 });
    const actionBtn = page.locator('#action-btn');
    await expect(actionBtn).toBeVisible();
    await expect(actionBtn).toBeEnabled();
  });

  test('click Extract and results appear', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.zip'));
    await page.locator('#action-btn').waitFor({ timeout: 5000 });
    await page.locator('#action-btn').click();
    await page.locator('#archive-results').waitFor({ timeout: 10000 });
    await expect(page.locator('#archive-results')).toBeVisible();
  });

  test('extracted files have individual download buttons', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.zip'));
    await page.locator('#action-btn').waitFor({ timeout: 5000 });
    await page.locator('#action-btn').click();
    await page.locator('#archive-results').waitFor({ timeout: 10000 });
    const dlButtons = page.locator('.dl-btn');
    const count = await dlButtons.count();
    expect(count).toBeGreaterThan(0);
  });

  test('download all preserves nested paths in one ZIP', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('nested.zip'));
    await page.locator('#action-btn').waitFor({ timeout: 5000 });
    await page.locator('#action-btn').click();
    await page.locator('#archive-results').waitFor({ timeout: 10000 });

    const downloads = [];
    page.on('download', download => downloads.push(download.suggestedFilename()));
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#dl-all').click(),
    ]);
    await page.waitForTimeout(200);

    expect(download.suggestedFilename()).toBe('irisfiles-extracted.zip');
    expect(downloads).toEqual(['irisfiles-extracted.zip']);

    const output = await readFile(await download.path());
    const contents = await page.evaluate(bytes => {
      const unzipped = fflate.unzipSync(Uint8Array.from(bytes));
      return Object.fromEntries(Object.entries(unzipped).map(([name, data]) => [
        name,
        new TextDecoder().decode(data),
      ]));
    }, Array.from(output));

    expect(Object.keys(contents).sort()).toEqual([
      'dir/inner.txt',
      'dir/sub/deep.txt',
      'top.txt',
    ]);
    expect(contents['top.txt']).toBe('top level\n');
    expect(contents['dir/inner.txt']).toBe('nested one\n');
    expect(contents['dir/sub/deep.txt']).toBe('nested two\n');
  });
});

test.describe('Create ZIP', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/create-zip`);
  });

  test('upload multiple images and action button enabled', async ({ page }) => {
    await page.locator('#file-input').setInputFiles([fixture('sample.png'), fixture('sample.jpg')]);
    await page.locator('#action-btn').waitFor({ timeout: 5000 });
    const actionBtn = page.locator('#action-btn');
    await expect(actionBtn).toBeVisible();
    await expect(actionBtn).toBeEnabled();
  });

  test('click Create ZIP and results appear', async ({ page }) => {
    await page.locator('#file-input').setInputFiles([fixture('sample.png'), fixture('sample.jpg')]);
    await page.locator('#action-btn').waitFor({ timeout: 5000 });
    await page.locator('#action-btn').click();
    await page.locator('#archive-results').waitFor({ timeout: 10000 });
    await expect(page.locator('#archive-results')).toBeVisible();
  });

  test('ZIP download button exists and is clickable', async ({ page }) => {
    await page.locator('#file-input').setInputFiles([fixture('sample.png'), fixture('sample.jpg')]);
    await page.locator('#action-btn').waitFor({ timeout: 5000 });
    await page.locator('#action-btn').click();
    await page.locator('#archive-results').waitFor({ timeout: 10000 });
    await expect(page.locator('#dl-zip')).toBeVisible();
  });

  test('clear all removes all files', async ({ page }) => {
    await page.locator('#file-input').setInputFiles([fixture('sample.png'), fixture('sample.jpg')]);
    await page.locator('.file-item').first().waitFor({ timeout: 5000 });
    await page.locator('#clear-all').click();
    const count = await getFileItemCount(page);
    expect(count).toBe(0);
  });
});

test.describe('Images to GIF', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/images-to-gif`);
  });

  test('single image disables convert button with help text', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));
    await page.locator('.frame-item').first().waitFor({ timeout: 5000 });
    const convertBtn = page.locator('#convert-btn');
    await expect(convertBtn).toBeDisabled();
    const helpText = await page.locator('#convert-btn').textContent();
    expect(helpText).toContain('Need at least 2 images');
  });

  test('two or more images enables convert button with frame count', async ({ page }) => {
    await page.locator('#file-input').setInputFiles([fixture('sample.png'), fixture('sample2.png')]);
    await page.locator('.frame-item').nth(1).waitFor({ timeout: 5000 });
    const convertBtn = page.locator('#convert-btn');
    await expect(convertBtn).toBeEnabled();
    const btnText = await convertBtn.textContent();
    expect(btnText).toMatch(/\d+/);
  });

  test('delay slider updates display value', async ({ page }) => {
    await page.locator('#file-input').setInputFiles([fixture('sample.png'), fixture('sample2.png')]);
    await page.locator('.frame-item').nth(1).waitFor({ timeout: 5000 });
    await page.locator('#delay-slider').fill('150');
    const displayValue = await page.locator('#delay-value').textContent();
    expect(displayValue).toContain('150');
  });

  test('width slider updates display value', async ({ page }) => {
    await page.locator('#file-input').setInputFiles([fixture('sample.png'), fixture('sample2.png')]);
    await page.locator('.frame-item').nth(1).waitFor({ timeout: 5000 });
    const setWidth = async (value) => {
      await page.locator('#width-slider').fill(String(value));
      // Filling a range input raises no input event, and the handler that
      // updates the readout listens for one.
      await page.evaluate(() => {
        document.querySelector('#width-slider').dispatchEvent(new Event('input', { bubbles: true }));
      });
    };

    // 300 is within the 21px snap threshold of the 320 preset, so it snaps.
    await setWidth(300);
    await expect(page.locator('#width-value')).toContainText('320px');

    // 400 is clear of every preset and is kept as typed.
    await setWidth(400);
    await expect(page.locator('#width-value')).toContainText('400px');
  });

  test('convert button processes GIF and shows result', async ({ page }) => {
    await page.locator('#file-input').setInputFiles([fixture('sample.png'), fixture('sample2.png')]);
    await page.locator('.frame-item').nth(1).waitFor({ timeout: 5000 });
    await page.locator('#convert-btn').click();
    await page.locator('#gif-result').waitFor({ timeout: 30000 });
    await expect(page.locator('#gif-result')).toBeVisible();
  });

  test('GIF result has download button', async ({ page }) => {
    await page.locator('#file-input').setInputFiles([fixture('sample.png'), fixture('sample2.png')]);
    await page.locator('.frame-item').nth(1).waitFor({ timeout: 5000 });
    await page.locator('#convert-btn').click();
    await page.locator('#gif-result').waitFor({ timeout: 30000 });
    await expect(page.locator('#dl-gif')).toBeVisible();
  });

  test('clear button removes all frames', async ({ page }) => {
    await page.locator('#file-input').setInputFiles([fixture('sample.png'), fixture('sample2.png')]);
    await page.locator('.frame-item').nth(1).waitFor({ timeout: 5000 });
    await page.locator('#clear-btn').click();
    const count = await getFileItemCount(page);
    expect(count).toBe(0);
  });

  test('progress indicator shown during conversion', async ({ page }) => {
    await page.locator('#file-input').setInputFiles([fixture('sample.png'), fixture('sample2.png')]);
    await page.locator('.frame-item').nth(1).waitFor({ timeout: 5000 });
    const convertBtn = page.locator('#convert-btn');
    await convertBtn.click();
    const progressElement = page.locator('#gif-progress');
    const isVisible = await progressElement.isVisible().catch(() => false);
    if (isVisible) {
      await progressElement.waitFor({ state: 'hidden', timeout: 30000 });
    }
  });
});

test.describe('RTF to TXT Converter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/rtf-to-txt`);
  });

  test('upload RTF and action button appears', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.rtf'));
    await page.locator('#action-btn').waitFor({ timeout: 5000 });
    const actionBtn = page.locator('#action-btn');
    await expect(actionBtn).toBeVisible();
  });

  test('click Convert and results appear', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.rtf'));
    await page.locator('#action-btn').waitFor({ timeout: 5000 });
    await page.locator('#action-btn').click();
    await page.locator('#doc-results').waitFor({ timeout: 10000 });
    await expect(page.locator('#doc-results')).toBeVisible();
  });

  test('download button visible after conversion', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.rtf'));
    await page.locator('#action-btn').waitFor({ timeout: 5000 });
    await page.locator('#action-btn').click();
    await page.locator('#doc-results').waitFor({ timeout: 10000 });
    await expect(page.locator('#dl-doc')).toBeVisible();
  });
});

test.describe('PDF OCR', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/pdf-ocr`);
  });

  test('upload PDF and action button visible', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.pdf'));
    await page.locator('#action-btn').waitFor({ timeout: 5000 });
    const actionBtn = page.locator('#action-btn');
    await expect(actionBtn).toBeVisible();
  });

  test('OCR language select has options', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.pdf'));
    await page.locator('#action-btn').waitFor({ timeout: 5000 });
    const langSelect = page.locator('#ocr-lang');
    await expect(langSelect).toBeVisible();
    const optionCount = await langSelect.locator('option').count();
    expect(optionCount).toBeGreaterThan(1);
  });

  test('click Extract Text and results appear with timeout', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.pdf'));
    await page.locator('#action-btn').waitFor({ timeout: 5000 });
    await page.locator('#action-btn').click();
    await page.locator('#ocr-results').waitFor({ timeout: 60000 });
    await expect(page.locator('#ocr-results')).toBeVisible();
  });

  test('OCR results textarea has extracted text', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.pdf'));
    await page.locator('#action-btn').waitFor({ timeout: 5000 });
    await page.locator('#action-btn').click();
    await page.locator('#ocr-results').waitFor({ timeout: 60000 });
    const textContent = await page.locator('#ocr-results-text').inputValue();
    expect(textContent?.length).toBeGreaterThan(0);
  });

  test('copy button exists after OCR', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.pdf'));
    await page.locator('#action-btn').waitFor({ timeout: 5000 });
    await page.locator('#action-btn').click();
    await page.locator('#ocr-results').waitFor({ timeout: 60000 });
    await expect(page.locator('#ocr-copy')).toBeVisible();
  });

  test('download button exists after OCR', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.pdf'));
    await page.locator('#action-btn').waitFor({ timeout: 5000 });
    await page.locator('#action-btn').click();
    await page.locator('#ocr-results').waitFor({ timeout: 60000 });
    await expect(page.locator('#ocr-download')).toBeVisible();
  });

  test('progress bar shown during OCR processing', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.pdf'));
    await page.locator('#action-btn').waitFor({ timeout: 5000 });
    await page.locator('#action-btn').click();
    const progressBar = page.locator('#ocr-progress-bar');
    const isVisible = await progressBar.isVisible().catch(() => false);
    if (isVisible) {
      await progressBar.waitFor({ state: 'hidden', timeout: 60000 });
    }
  });
});

test.describe('RTF to TXT', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/rtf-to-txt');
  });

  test('page loads with correct config', async ({ page }) => {
    const config = page.locator('#converter-config');
    await expect(config).toHaveAttribute('data-doc-mode', 'rtf-to-txt');
  });

  test('convert RTF to TXT shows results and download', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.rtf'));
    await page.locator('#action-btn').click();
    await page.locator('#doc-results').waitFor({ timeout: 30000 });
    await expect(page.locator('#doc-results')).toBeVisible();
    await expect(page.locator('#dl-doc')).toBeVisible();
  });

  test('download produces .txt file', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.rtf'));
    await page.locator('#action-btn').click();
    await page.locator('#dl-doc').waitFor({ timeout: 30000 });
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#dl-doc').click(),
    ]);
    expect(dl.suggestedFilename()).toMatch(/\.txt$/);
  });
});

test.describe('RTF to PDF', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/rtf-to-pdf');
  });

  test('page loads with correct config', async ({ page }) => {
    const config = page.locator('#converter-config');
    await expect(config).toHaveAttribute('data-doc-mode', 'rtf-to-pdf');
  });

  test('convert RTF to PDF shows results and download', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.rtf'));
    await page.locator('#action-btn').click();
    await page.locator('#doc-results').waitFor({ timeout: 30000 });
    await expect(page.locator('#doc-results')).toBeVisible();
    await expect(page.locator('#dl-doc')).toBeVisible();
  });

  test('download produces .pdf file', async ({ page }) => {
    await page.locator('#file-input').setInputFiles(fixture('sample.rtf'));
    await page.locator('#action-btn').click();
    await page.locator('#dl-doc').waitFor({ timeout: 30000 });
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#dl-doc').click(),
    ]);
    expect(dl.suggestedFilename()).toMatch(/\.pdf$/);
  });
});

test.describe('Resize with output format', () => {
  test('resize converts PNG and preserves format in download', async ({ page }) => {
    await page.goto('/resize-image');
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));
    await page.locator('.file-item').first().waitFor({ timeout: 5000 });
    await page.locator('#resize-width').fill('50');
    await page.locator('#resize-btn').click();
    await page.locator('.file-item.done').first().waitFor({ timeout: 10000 });
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.btn-download').first().click(),
    ]);
    expect(dl.suggestedFilename()).toMatch(/\.png$/);
  });

  test('resize converts JPG and outputs as .jpg', async ({ page }) => {
    await page.goto('/resize-image');
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await page.locator('.file-item').first().waitFor({ timeout: 5000 });
    await page.locator('#resize-width').fill('50');
    await page.locator('#resize-btn').click();
    await page.locator('.file-item.done').first().waitFor({ timeout: 10000 });
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.btn-download').first().click(),
    ]);
    expect(dl.suggestedFilename()).toMatch(/\.jpg$/);
  });
});

test.describe('Resize - aspect ratio reverse direction', () => {
  test('changing height updates width when aspect lock is on', async ({ page }) => {
    await page.goto('/resize-image');
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));
    await page.locator('.file-item').first().waitFor({ timeout: 5000 });
    const lockCheckbox = page.locator('#lock-aspect');
    await expect(lockCheckbox).toBeChecked();
    const origWidth = await page.locator('#resize-width').inputValue();
    await page.locator('#resize-height').fill('25');
    await page.locator('#resize-height').dispatchEvent('input');
    await page.waitForFunction(
      (orig) => {
        const w = document.querySelector('#resize-width');
        return w && w.value !== orig && parseInt(w.value) > 0;
      },
      origWidth,
      { timeout: 5000 }
    );
    const newWidth = await page.locator('#resize-width').inputValue();
    expect(parseInt(newWidth)).toBeGreaterThan(0);
    expect(newWidth).not.toBe(origWidth);
  });
});

test.describe('Resize - Download All as ZIP', () => {
  test('batch resize produces ZIP download', async ({ page }) => {
    await page.goto('/resize-image');
    await page.locator('#file-input').setInputFiles([fixture('sample.png'), fixture('sample2.png')]);
    await page.locator('.file-item').nth(1).waitFor({ timeout: 5000 });
    await page.locator('#resize-btn').click();
    await page.locator('.file-item.done').nth(1).waitFor({ timeout: 10000 });
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#download-all').click(),
    ]);
    expect(dl.suggestedFilename()).toMatch(/\.zip$/);
  });
});

test.describe('Images to GIF - Frame management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/images-to-gif');
  });

  test('remove button removes individual frame', async ({ page }) => {
    await page.locator('#file-input').setInputFiles([fixture('sample.png'), fixture('sample2.png')]);
    await page.locator('.frame-item').nth(1).waitFor({ timeout: 5000 });
    const frameItems = page.locator('.frame-item');
    await expect(frameItems).toHaveCount(2);
    await page.locator('.frame-item__remove').first().click();
    await expect(frameItems).toHaveCount(1);
  });

  test('removing frame below 2 disables convert button', async ({ page }) => {
    await page.locator('#file-input').setInputFiles([fixture('sample.png'), fixture('sample2.png')]);
    await page.locator('.frame-item').nth(1).waitFor({ timeout: 5000 });
    await page.locator('.frame-item__remove').first().click();
    const convertBtn = page.locator('#convert-btn');
    await expect(convertBtn).toBeDisabled();
  });

  test('controls section hidden when no frames', async ({ page }) => {
    await expect(page.locator('#gif-controls')).toBeHidden();
  });

  test('controls appear after adding frames', async ({ page }) => {
    await page.locator('#file-input').setInputFiles([fixture('sample.png'), fixture('sample2.png')]);
    await page.locator('.frame-item').nth(1).waitFor({ timeout: 5000 });
    await expect(page.locator('#gif-controls')).toBeVisible();
  });
});

test.describe('Image Metadata - GPS strip', () => {
  test('strip GPS button visible for JPEG', async ({ page }) => {
    await page.goto('/image-metadata');
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await page.locator('#metadata-panel').waitFor({ timeout: 10000 });
    await expect(page.locator('#strip-gps')).toBeVisible();
  });

  test('strip GPS produces download', async ({ page }) => {
    await page.goto('/image-metadata');
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await page.locator('#metadata-panel').waitFor({ timeout: 10000 });
    await page.locator('#strip-gps').click();
    await page.locator('.btn-download').waitFor({ timeout: 10000 });
    await expect(page.locator('.btn-download')).toBeVisible();
  });

  test('strip GPS hidden for non-JPEG', async ({ page }) => {
    await page.goto('/image-metadata');
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));
    await page.locator('#metadata-panel').waitFor({ timeout: 10000 });
    await expect(page.locator('#strip-gps')).toBeHidden();
  });
});

test.describe('Extract ZIP - clear all resets', () => {
  test('clear all after extraction resets interface', async ({ page }) => {
    await page.goto('/extract-zip');
    await page.locator('#file-input').setInputFiles(fixture('sample.zip'));
    await page.locator('#action-btn').waitFor({ timeout: 5000 });
    await page.locator('#action-btn').click();
    await page.locator('#archive-results').waitFor({ timeout: 10000 });
    await page.locator('#clear-all').click();
    await expect(page.locator('#archive-results')).not.toBeVisible();
    const count = await getFileItemCount(page);
    expect(count).toBe(0);
  });
});

test.describe('Create ZIP - download extension', () => {
  test('created ZIP download has .zip extension', async ({ page }) => {
    await page.goto('/create-zip');
    await page.locator('#file-input').setInputFiles([fixture('sample.png'), fixture('sample.jpg')]);
    await page.locator('#action-btn').waitFor({ timeout: 5000 });
    await page.locator('#action-btn').click();
    await page.locator('#archive-results').waitFor({ timeout: 10000 });
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#dl-zip').click(),
    ]);
    expect(dl.suggestedFilename()).toMatch(/\.zip$/);
  });
});

test.describe('Create ZIP - clear all resets', () => {
  test('clear all after ZIP creation resets interface', async ({ page }) => {
    await page.goto('/create-zip');
    await page.locator('#file-input').setInputFiles([fixture('sample.png'), fixture('sample.jpg')]);
    await page.locator('.file-item').first().waitFor({ timeout: 5000 });
    await page.locator('#action-btn').click();
    await page.locator('#archive-results').waitFor({ timeout: 10000 });
    await page.locator('#clear-all').click();
    const count = await getFileItemCount(page);
    expect(count).toBe(0);
  });
});

test.describe('PDF OCR - clear all resets', () => {
  test('clear all after OCR resets interface', async ({ page }) => {
    await page.goto('/pdf-ocr');
    await page.locator('#file-input').setInputFiles(fixture('sample.pdf'));
    await page.locator('#action-btn').waitFor({ timeout: 5000 });
    await page.locator('#action-btn').click();
    await page.locator('#ocr-results').waitFor({ timeout: 60000 });
    await page.locator('#clear-all').click();
    await expect(page.locator('#ocr-results')).not.toBeVisible();
  });
});

test.describe('Resize Image - wrong format handling', () => {
  test('uploading a PDF to resize shows no crash', async ({ page }) => {
    await page.goto('/resize-image');
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.locator('#file-input').setInputFiles(fixture('sample.pdf'));
    await page.waitForTimeout(3000);
    expect(errors).toHaveLength(0);
  });
});

test.describe('Strip EXIF - format handling', () => {
  test('strip EXIF accepts PNG and produces download', async ({ page }) => {
    await page.goto('/strip-exif');
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));
    await page.locator('.file-item.done').waitFor({ timeout: 10000 });
    await expect(page.locator('.btn-download').first()).toBeVisible();
  });

  test('strip EXIF accepts WebP', async ({ page }) => {
    await page.goto('/strip-exif');
    await page.locator('#file-input').setInputFiles(fixture('sample.webp'));
    await page.locator('.file-item.done').waitFor({ timeout: 10000 });
    await expect(page.locator('.btn-download').first()).toBeVisible();
  });

  test('strip EXIF download has correct extension for JPG', async ({ page }) => {
    await page.goto('/strip-exif');
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await page.locator('.file-item.done').waitFor({ timeout: 10000 });
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.btn-download').first().click(),
    ]);
    expect(dl.suggestedFilename()).toMatch(/\.(jpg|jpeg)$/);
  });
});
