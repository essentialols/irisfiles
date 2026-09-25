import fs from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

test.setTimeout(120000);

const MULTI_AUDIO_MKV = fixture('multi-audio.mkv');
const AUDIO_ONLY_MKV = fixture('audio-only.mkv');
const VIDEO_ONLY_AVI = fixture('sample.avi');
const SUBTITLED_MP4 = fixture('subtitled.mp4');

// Walk size-delimited ISOBMFF boxes rather than scanning the whole file for the
// literal 'hdlr': mdat sample data can contain those four bytes, so a raw byte
// scan counts tracks that do not exist.
function readBoxes(buf, start, end) {
  const boxes = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      const large = buf.readBigUInt64BE(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(large);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset; // box extends to the end of its parent
    }
    if (size < headerSize || offset + size > end) break;
    boxes.push({ type, start: offset + headerSize, end: offset + size });
    offset += size;
  }
  return boxes;
}

function childrenOfType(buf, boxes, type) {
  return boxes
    .filter(box => box.type === type)
    .flatMap(box => readBoxes(buf, box.start, box.end));
}

// Counts media handlers ('vide', 'soun', 'sbtl') along moov/trak/mdia/hdlr.
function countTrackHandlers(buf, handler) {
  const top = readBoxes(buf, 0, buf.length);
  const inMoov = childrenOfType(buf, top, 'moov');
  const inTrak = childrenOfType(buf, inMoov, 'trak');
  const inMdia = childrenOfType(buf, inTrak, 'mdia');
  return inMdia.filter(box => box.type === 'hdlr'
    // hdlr payload: version/flags (4), pre_defined (4), handler_type (4)
    && buf.toString('ascii', box.start + 8, box.start + 12) === handler).length;
}

async function convertAndDownload(page, route, file, expectedName) {
  await page.goto(route);
  await page.locator('#file-input').setInputFiles(file);

  await expect(page.locator('#action-btn')).toBeEnabled();
  await page.locator('#action-btn').click();
  await expect(page.locator('.btn-download')).toBeVisible({ timeout: 120000 });

  const downloadPromise = page.waitForEvent('download');
  await page.locator('.btn-download').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(expectedName);
  return fs.readFile(await download.path());
}

test('MKV to MP4 preserves all audio tracks', async ({ page }) => {
  await page.goto('/mkv-to-mp4');
  await page.locator('#file-input').setInputFiles({
    name: 'Résumé_日本語_multi-audio.mkv',
    mimeType: 'video/x-matroska',
    buffer: await fs.readFile(MULTI_AUDIO_MKV),
  });

  await expect(page.locator('.file-item__name')).toHaveText('Résumé_日本語_multi-audio.mkv');
  await expect(page.locator('#action-btn')).toBeEnabled();
  await page.locator('#action-btn').click();
  await expect(page.locator('.btn-download')).toBeVisible({ timeout: 120000 });

  const downloadPromise = page.waitForEvent('download');
  await page.locator('.btn-download').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Résumé_日本語_multi-audio.mp4');

  const output = await fs.readFile(await download.path());
  expect(countTrackHandlers(output, 'vide')).toBe(1);
  expect(countTrackHandlers(output, 'soun')).toBe(2);
});

// The audio map is optional, so an input with no audio at all must still
// convert rather than fail "Stream map '0:a' matches no streams".
test('a video-only AVI still converts', async ({ page }) => {
  const output = await convertAndDownload(page, '/avi-to-mp4', VIDEO_ONLY_AVI, 'sample.mp4');
  expect(countTrackHandlers(output, 'vide')).toBe(1);
  expect(countTrackHandlers(output, 'soun')).toBe(0);
});

// The mirror case: the video map has to be optional too, or an audio-only
// container (a sound-only MKV or MOV) hard-fails where it used to convert via
// ffmpeg's default stream selection.
test('an audio-only MKV still converts', async ({ page }) => {
  const output = await convertAndDownload(page, '/mkv-to-mp4', AUDIO_ONLY_MKV, 'audio-only.mp4');
  expect(countTrackHandlers(output, 'vide')).toBe(0);
  expect(countTrackHandlers(output, 'soun')).toBe(1);
});

// Any explicit -map turns off default stream selection wholesale, which is how
// mapping audio tracks silently started dropping subtitles on the one target
// that used to carry them. Matroska writes each track's codec as an ASCII
// CodecID, so the muxed subtitle track is visible in the raw bytes.
test('MP4 to MKV keeps the subtitle track', async ({ page }) => {
  const output = await convertAndDownload(page, '/mp4-to-mkv', SUBTITLED_MP4, 'subtitled.mkv');
  expect(output.includes('V_MPEG4/ISO/AVC')).toBe(true);
  expect(output.includes('A_AAC')).toBe(true);
  expect(output.includes('S_TEXT/ASS')).toBe(true);
});
