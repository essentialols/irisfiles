import { test, expect } from '@playwright/test';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fixture, dropFile, dropFiles, waitForDone, expectDownloadOnClick, getFileItemCount } from './helpers.mjs';

// This spec produces first-hand runtime evidence for the AVI-to-WebM converter:
// real conversion correctness (verified by system ffprobe, not the filename),
// error-path behavior on a damaged input, single-file-only behavior, and a
// full network trace of the conversion flow for the privacy guide. It does
// NOT touch avi-to-webm.html: another worker owns that file concurrently.

const FFPROBE = '/opt/homebrew/bin/ffprobe';
const EVIDENCE_DIR = '/Users/ingmarsturm/.project-state/irisfiles-seo';
const RAW_DIR = join(EVIDENCE_DIR, 'raw');
const SCREENSHOT_DIR = join(EVIDENCE_DIR, 'screenshots');
if (!existsSync(RAW_DIR)) mkdirSync(RAW_DIR, { recursive: true });
if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });

function ffprobeJson(path) {
  const out = execFileSync(FFPROBE, [
    '-v', 'error',
    '-show_format', '-show_streams',
    '-print_format', 'json',
    path,
  ], { encoding: 'utf8' });
  return JSON.parse(out);
}

function writeRaw(name, data) {
  writeFileSync(join(RAW_DIR, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

test.describe('AVI to WebM - conversion correctness', () => {
  test.setTimeout(180_000);

  test('video-only AVI (sample.avi, h264, no audio) converts to a real VP8 WebM', async ({ page }) => {
    await page.goto('/avi-to-webm');
    await dropFile(page, '#drop-zone', fixture('sample.avi'));
    await expect(page.locator('#action-btn')).toBeVisible();

    const t0 = Date.now();
    await page.locator('#action-btn').click();
    await waitForDone(page, { timeout: 150_000 });
    const wallMs = Date.now() - t0;

    const download = await expectDownloadOnClick(page, '.btn-download');
    const outDir = mkdtempSync(join(tmpdir(), 'irisfiles-avi-webm-'));
    const outPath = join(outDir, 'video-only-out.webm');
    await download.saveAs(outPath);

    const bytes = readFileSync(outPath);
    const magic = Array.from(bytes.subarray(0, 4));
    expect(magic).toEqual([0x1a, 0x45, 0xdf, 0xa3]); // EBML header, not filename-based

    const probe = ffprobeJson(outPath);
    writeRaw('probe-video-only-output.json', probe);

    expect(probe.format.format_name).toContain('matroska');
    const vStream = probe.streams.find((s) => s.codec_type === 'video');
    expect(vStream, 'output must contain a video stream').toBeTruthy();
    expect(vStream.codec_name).toBe('vp8');

    const inputProbe = ffprobeJson(fixture('sample.avi'));
    writeRaw('probe-video-only-input.json', inputProbe);

    writeRaw('measurement-video-only.json', {
      inputPath: fixture('sample.avi'),
      inputSizeBytes: inputProbe.format.size,
      inputDurationSec: inputProbe.format.duration,
      inputDims: `${inputProbe.streams[0].width}x${inputProbe.streams[0].height}`,
      inputVideoCodec: inputProbe.streams[0].codec_name,
      outputPath: outPath,
      outputSizeBytes: bytes.length,
      outputDurationSec: probe.format.duration,
      outputDims: `${vStream.width}x${vStream.height}`,
      outputVideoCodec: vStream.codec_name,
      durationDeltaSec: Number(probe.format.duration) - Number(inputProbe.format.duration),
      wallClockMs: wallMs,
    });
  });

  test('AVI with audio (sample-with-audio.avi, mjpeg+mp3) converts to VP8 + Vorbis WebM', async ({ page }) => {
    await page.goto('/avi-to-webm');
    await dropFile(page, '#drop-zone', fixture('sample-with-audio.avi'));
    await expect(page.locator('#action-btn')).toBeVisible();

    const timings = [];
    for (let run = 0; run < 2; run += 1) {
      if (run === 1) {
        // second pass: fresh navigation and drop, to get a second timing sample
        await page.goto('/avi-to-webm');
        await dropFile(page, '#drop-zone', fixture('sample-with-audio.avi'));
        await expect(page.locator('#action-btn')).toBeVisible();
      }
      const t0 = Date.now();
      await page.locator('#action-btn').click();
      await waitForDone(page, { timeout: 150_000 });
      timings.push(Date.now() - t0);

      if (run === 1) {
        const download = await expectDownloadOnClick(page, '.btn-download');
        const outDir = mkdtempSync(join(tmpdir(), 'irisfiles-avi-webm-audio-'));
        const outPath = join(outDir, 'with-audio-out.webm');
        await download.saveAs(outPath);

        const bytes = readFileSync(outPath);
        const magic = Array.from(bytes.subarray(0, 4));
        expect(magic).toEqual([0x1a, 0x45, 0xdf, 0xa3]);

        const probe = ffprobeJson(outPath);
        writeRaw('probe-with-audio-output.json', probe);

        expect(probe.format.format_name).toContain('matroska');
        const vStream = probe.streams.find((s) => s.codec_type === 'video');
        const aStream = probe.streams.find((s) => s.codec_type === 'audio');
        expect(vStream, 'output must contain a video stream').toBeTruthy();
        expect(aStream, 'output must contain an audio stream').toBeTruthy();
        expect(vStream.codec_name).toBe('vp8');
        expect(aStream.codec_name).toBe('vorbis');

        const inputProbe = ffprobeJson(fixture('sample-with-audio.avi'));
        writeRaw('probe-with-audio-input.json', inputProbe);

        writeRaw('measurement-with-audio.json', {
          inputPath: fixture('sample-with-audio.avi'),
          inputSizeBytes: inputProbe.format.size,
          inputDurationSec: inputProbe.format.duration,
          inputDims: `${vStreamDims(inputProbe)}`,
          inputVideoCodec: inputProbe.streams.find((s) => s.codec_type === 'video').codec_name,
          inputAudioCodec: inputProbe.streams.find((s) => s.codec_type === 'audio').codec_name,
          outputPath: outPath,
          outputSizeBytes: bytes.length,
          outputDurationSec: probe.format.duration,
          outputDims: `${vStream.width}x${vStream.height}`,
          outputVideoCodec: vStream.codec_name,
          outputAudioCodec: aStream.codec_name,
          durationDeltaSec: Number(probe.format.duration) - Number(inputProbe.format.duration),
          wallClockMsRuns: timings,
        });
      }
    }
  });

  function vStreamDims(probe) {
    const v = probe.streams.find((s) => s.codec_type === 'video');
    return `${v.width}x${v.height}`;
  }

  test('damaged/truncated AVI input shows an understandable error, not a hang', async ({ page }) => {
    await page.goto('/avi-to-webm');

    const fullBytes = readFileSync(fixture('sample.avi'));
    // Keep the RIFF/"AVI " magic and header list intact but cut off well before
    // the movi data chunk, so magic-byte detection accepts it as an AVI and the
    // failure has to come from the actual demux/decode step, not a sniff check.
    const truncated = fullBytes.subarray(0, 300);

    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'truncated-sample.avi',
      mimeType: 'video/x-msvideo',
      buffer: Buffer.from(truncated),
    });

    await expect(page.locator('#action-btn')).toBeVisible();
    await page.locator('#action-btn').click();

    const errorLocator = page.locator('.file-item__status.error, .file-item__status:has-text("Error"), .file-item__status:has-text("error")');
    await errorLocator.first().waitFor({ timeout: 60_000 });
    const errorText = await errorLocator.first().textContent();

    writeRaw('truncated-avi-error-text.txt', errorText || '(empty text content)');
    expect(errorText, 'error status must contain visible, non-empty text').toBeTruthy();
    expect(errorText.trim().length).toBeGreaterThan(0);
  });

  test('dropping two AVI files at once queues only one (no batch mode)', async ({ page }) => {
    await page.goto('/avi-to-webm');

    // First: try the file input directly, the same mechanism helpers.dropFiles
    // uses elsewhere in this suite. The input has no `multiple` attribute, so
    // Chromium itself refuses this before the app's own JS ever runs.
    let inputLevelError = null;
    try {
      await dropFiles(page, '#drop-zone', [fixture('sample.avi'), fixture('sample-with-audio.avi')]);
    } catch (e) {
      inputLevelError = e.message;
    }

    // Second, and more faithful to an actual OS drag-and-drop: dispatch a real
    // 'drop' DragEvent with a DataTransfer carrying two File objects straight
    // onto the visible drop zone. This path does not go through the <input>
    // element at all, so it tests what the app's own drop handler does with a
    // 2-file payload, independent of the input's own single-file constraint.
    const aviBytes = Array.from(readFileSync(fixture('sample.avi')));
    const audioBytes = Array.from(readFileSync(fixture('sample-with-audio.avi')));

    await page.evaluate(({ aviBytes, audioBytes }) => {
      const f1 = new File([new Uint8Array(aviBytes)], 'sample.avi', { type: 'video/x-msvideo' });
      const f2 = new File([new Uint8Array(audioBytes)], 'sample-with-audio.avi', { type: 'video/x-msvideo' });
      const dt = new DataTransfer();
      dt.items.add(f1);
      dt.items.add(f2);
      const zone = document.querySelector('#drop-zone');
      const opts = { bubbles: true, cancelable: true, dataTransfer: dt };
      zone.dispatchEvent(new DragEvent('dragenter', opts));
      zone.dispatchEvent(new DragEvent('dragover', opts));
      zone.dispatchEvent(new DragEvent('drop', opts));
    }, { aviBytes, audioBytes });

    await page.waitForTimeout(1500);
    const count = await getFileItemCount(page);

    writeRaw('two-file-drop-count.txt', [
      `input.setInputFiles([2 files]) on the non-multiple #file-input: ${inputLevelError ? `REJECTED by the browser itself: ${inputLevelError}` : 'did NOT throw (unexpected)'}`,
      `real DragEvent drop with 2-file DataTransfer onto #drop-zone: getFileItemCount() = ${count}`,
    ].join('\n'));

    expect(count).toBe(1);
  });
});

test.describe('AVI to WebM - network and privacy observation @evidence', () => {
  test.setTimeout(180_000);

  test('records every network request from load through conversion completion', async ({ page, browser }) => {
    const requests = [];
    const websockets = [];

    page.on('request', (req) => {
      requests.push({
        event: 'request',
        method: req.method(),
        url: req.url(),
        resourceType: req.resourceType(),
        postDataSize: req.postData() ? req.postData().length : (req.postDataBuffer() ? req.postDataBuffer().length : 0),
      });
    });
    page.on('requestfinished', (req) => {
      requests.push({
        event: 'requestfinished',
        method: req.method(),
        url: req.url(),
        resourceType: req.resourceType(),
      });
    });
    page.on('websocket', (ws) => {
      websockets.push(ws.url());
    });

    await page.goto('/avi-to-webm');

    const swRegistrations = await page.evaluate(() =>
      (navigator.serviceWorker && navigator.serviceWorker.getRegistrations)
        ? navigator.serviceWorker.getRegistrations().then((r) => r.length)
        : -1);

    await dropFile(page, '#drop-zone', fixture('sample-with-audio.avi'));
    await expect(page.locator('#action-btn')).toBeVisible();
    await page.locator('#action-btn').click();
    await waitForDone(page, { timeout: 150_000 });

    const download = await expectDownloadOnClick(page, '.btn-download');
    const outDir = mkdtempSync(join(tmpdir(), 'irisfiles-avi-webm-net-'));
    await download.saveAs(join(outDir, 'net-observation-out.webm'));

    // give any trailing async request a moment to show up in the log
    await page.waitForTimeout(1000);

    const distinctUrls = [...new Set(requests.map((r) => r.url))].sort();
    const postLike = requests.filter((r) => r.method === 'POST' || r.method === 'PUT');
    const bodied = requests.filter((r) => r.postDataSize && r.postDataSize > 0);

    const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: '/Users/ingmarsturm/Documents/GitHub/irisfiles',
      encoding: 'utf8',
    }).trim();

    const report = {
      testedAt: new Date().toISOString(),
      commitSha,
      browserVersion: browser.version(),
      baseURL: page.url(),
      serviceWorkerRegistrationCount: swRegistrations,
      websocketUrls: websockets,
      distinctRequestUrls: distinctUrls,
      postOrPutRequests: postLike,
      requestsWithNonZeroBody: bodied,
      totalRequestEvents: requests.length,
    };

    writeRaw('network-observation.json', report);
    writeRaw('network-observation-all-requests.json', requests);

    // Nothing here should be a POST/PUT carrying the video: this is the
    // assertion the privacy guide will cite.
    expect(postLike.length, `expected no POST/PUT requests, found: ${JSON.stringify(postLike)}`).toBe(0);
  });

  test('second conversion after network is blocked (post cache warm-up)', async ({ page }) => {
    await page.goto('/avi-to-webm');
    await dropFile(page, '#drop-zone', fixture('sample-with-audio.avi'));
    await expect(page.locator('#action-btn')).toBeVisible();
    await page.locator('#action-btn').click();
    await waitForDone(page, { timeout: 150_000 });

    // Reload fresh, then block every request to the jsDelivr CDN (and any
    // other cross-origin host) to see whether a second conversion still
    // works once FFmpeg.wasm is cached, or whether it silently refetches.
    await page.goto('/avi-to-webm');
    let blockedCount = 0;
    await page.route('**://cdn.jsdelivr.net/**', (route) => {
      blockedCount += 1;
      route.abort();
    });

    await dropFile(page, '#drop-zone', fixture('sample-with-audio.avi'));
    await expect(page.locator('#action-btn')).toBeVisible();
    await page.locator('#action-btn').click();

    let outcome = 'unknown';
    try {
      await waitForDone(page, { timeout: 60_000 });
      outcome = 'succeeded';
    } catch (e) {
      outcome = 'failed-or-timed-out';
    }

    // Asserted, not just recorded: the whole point of the claim in the privacy
    // guide is that a warm cache means a second conversion needs no network.
    expect(outcome).toBe('succeeded');

    writeRaw('second-conversion-blocked-cdn.json', {
      blockedRequestCount: blockedCount,
      blockedPattern: '**://cdn.jsdelivr.net/**',
      outcome,
      note: 'This blocks the jsDelivr CDN pattern after a page reload, not a full offline test: only that one host pattern is intercepted, and other origins (e.g. same-origin /data/file-signatures.json) are left untouched.',
    });
  });
});

test.describe('AVI to WebM - screenshots @evidence', () => {
  test('desktop and mobile viewport screenshots', async ({ browser }) => {
    const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const desktopPage = await desktopContext.newPage();
    await desktopPage.goto('/avi-to-webm');
    await desktopPage.waitForTimeout(500);
    await desktopPage.screenshot({ path: join(SCREENSHOT_DIR, 'avi-to-webm-desktop.png'), fullPage: true });
    await desktopContext.close();

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto('/avi-to-webm');
    await mobilePage.waitForTimeout(500);
    await mobilePage.screenshot({ path: join(SCREENSHOT_DIR, 'avi-to-webm-mobile.png'), fullPage: true });
    await mobileContext.close();
  });
});
