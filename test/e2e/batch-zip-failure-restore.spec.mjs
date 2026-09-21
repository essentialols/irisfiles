import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

// #197 and #198 fixed this for audio-ui and resize-ui: when the batch ZIP
// throws, the handler rejected and left "Download All as ZIP" disabled and
// stuck on "Zipping...", so the user could not retry without reloading. The
// same handler shape existed in four more modules. These cover all of them.
//
// The blob read is the seam. Every one of these handlers starts with a
// Promise.all over outputBlob.arrayBuffer(), so rejecting there exercises the
// real rejection path. Patching fflate.zipSync does NOT work: fflate arrives as
// an ES module namespace whose properties are read-only, so the assignment
// silently no-ops and the ZIP succeeds. Patch only after conversion is done.
async function breakBlobRead(page) {
  await page.evaluate(() => {
    Blob.prototype.arrayBuffer = function () {
      return Promise.reject(new Error('forced blob read failure'));
    };
  });
}

async function expectRestored(page, button) {
  await expect(button).toBeEnabled({ timeout: 10_000 });
  await expect(button).not.toHaveText(/Zipping/i);
}

async function runBatchThenFail(page, path, files, buttonSelector) {
  await page.goto(path);
  await page.locator('#file-input').setInputFiles(files);
  await page.locator('.file-item.done').nth(files.length - 1).waitFor({ timeout: 45_000 });
  const btn = page.locator(buttonSelector);
  await expect(btn).toBeVisible({ timeout: 20_000 });
  await breakBlobRead(page);
  await btn.click();
  return btn;
}

test.describe('a failed batch ZIP restores its button', () => {
  test('strip-exif', async ({ page }) => {
    const btn = await runBatchThenFail(page, '/strip-exif',
      [fixture('sample.png'), fixture('sample.jpg')], '#download-all');
    await expectRestored(page, btn);
  });

  test('png-to-ico', async ({ page }) => {
    const btn = await runBatchThenFail(page, '/png-to-ico',
      [fixture('sample.png'), fixture('landscape.png')], '#download-all');
    await expectRestored(page, btn);
  });
});
