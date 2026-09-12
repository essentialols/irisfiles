import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

// choose() awaited renderPdfThumbnails and then installed pages/order
// unconditionally, so a superseded load could overwrite a newer one's pages
// while currentFile already pointed at the newer file. A generation guard now
// discards the stale result.
//
// This asserts the invariant the guard protects -- the grid always describes
// the file named above it -- after two loads are started back to back. It does
// NOT prove the stale-write ordering: pdf.js appears to serialise thumbnail
// work, so the first-queued load also finishes first and the newer selection
// wins on its own. The ordering was only ever reproduced with mocked deferred
// promises, and this test passes with and without the guard.
test('the page grid always matches the named file after rapid re-selection', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 20 });

  await page.goto('/delete-pdf-pages');

  // Park each file on a detached input so neither selection starts a load yet.
  // The real input is not multiple, and two sequential setInputFiles calls do
  // not overlap because the first load has already settled by the second.
  await page.evaluate(() => {
    for (const id of ['race-a', 'race-b']) {
      const el = document.createElement('input');
      el.type = 'file';
      el.id = id;
      document.body.appendChild(el);
    }
  });
  await page.locator('#race-a').setInputFiles(fixture('multi-page.pdf'));
  await page.locator('#race-b').setInputFiles(fixture('sample.pdf'));

  await page.evaluate(() => {
    const real = document.getElementById('file-input');
    const fire = (file) => {
      Object.defineProperty(real, 'files', { configurable: true, value: [file] });
      real.dispatchEvent(new Event('change'));
    };
    fire(document.getElementById('race-a').files[0]);
    fire(document.getElementById('race-b').files[0]);
  });

  await expect(page.locator('.file-item__name')).toHaveText('sample.pdf');
  await page.waitForTimeout(5000);

  // sample.pdf has one page, multi-page.pdf has three. Three cards under the
  // name sample.pdf would mean the grid describes a different document.
  await expect(page.locator('.file-item__name')).toHaveText('sample.pdf');
  await expect(page.locator('.pdf-page-card')).toHaveCount(1);
});
