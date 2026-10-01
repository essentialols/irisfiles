import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

// showError() clears the results panel, so an obsolete failure used to erase a
// newer run's download card and replace it with a stale message. It is now
// guarded by the same revision check the success paths already used.
//
// The stale ordering itself is not reproduced here: fflate finishes a zip before
// a Clear click can land, even throttled, so the superseded branch is not
// reachable from a test. These cover the paths that are, and would catch the
// guard being wrong in the ordinary direction: a failed run that never recovers.
test.describe('archive run state', () => {
  test('a failed extract restores the button and a later valid extract still works', async ({ page }) => {
    await page.goto('/extract-zip');

    // Park the valid ZIP on a detached input. Overriding file-input.files below
    // shadows the property, so a later setInputFiles would not be seen.
    await page.evaluate(() => {
      const el = document.createElement('input');
      el.type = 'file';
      el.id = 'park';
      document.body.appendChild(el);
    });
    await page.locator('#park').setInputFiles(fixture('multi.zip'));

    const select = (what) => page.evaluate((which) => {
      const input = document.getElementById('file-input');
      const file = which === 'junk'
        ? new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], 'broken.zip', { type: 'application/zip' })
        : document.getElementById('park').files[0];
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      input.dispatchEvent(new Event('change'));
    }, what);

    await select('junk');
    await page.locator('#action-btn').click();
    await expect(page.locator('#archive-results')).toContainText(/invalid/i, { timeout: 20000 });
    await expect(page.locator('#action-btn')).toBeEnabled();
    await expect(page.locator('#action-btn')).toHaveText('Extract Files');

    // Extract mode replaces the ZIP, so this supersedes the failed run.
    await select('valid');
    await page.locator('#action-btn').click();
    await expect(page.locator('#archive-results')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#archive-results')).not.toContainText(/invalid/i);
    await expect(page.locator('#action-btn')).toHaveText('Extract Files');
  });

  test('replacing a ZIP mid-extract restores idle controls and stale work cannot clobber them', async ({ page }) => {
    await page.goto('/extract-zip');

    // Make both archives deterministically slow before fflate sees them: the
    // first (superseded) run wakes at 500 ms, the replacement run at 1500 ms,
    // so the stale run always finishes while the newer run is still in flight.
    await page.evaluate(() => {
      const nativeArrayBuffer = File.prototype.arrayBuffer;
      const delays = { 'multi.zip': 500, 'sample.zip': 1500 };
      File.prototype.arrayBuffer = function () {
        const delay = delays[this.name];
        if (!delay) return nativeArrayBuffer.call(this);
        return new Promise((resolve, reject) => {
          setTimeout(() => nativeArrayBuffer.call(this).then(resolve, reject), delay);
        });
      };
    });

    const btn = page.locator('#action-btn');
    await page.locator('#file-input').setInputFiles(fixture('multi.zip'));
    await btn.click();
    await expect(btn).toContainText(/Processing|Extracting/);

    // Replacing the input must reset the controls at once, not when the
    // superseded run eventually finishes (500 ms), hence the short timeout.
    await page.locator('#file-input').setInputFiles(fixture('sample.zip'));
    await expect(btn).toHaveText('Extract Files', { timeout: 250 });
    await expect(btn).toBeEnabled({ timeout: 250 });

    await btn.click();
    await expect(btn).toBeDisabled();
    await expect(btn).toContainText(/Processing|Extracting/);

    // The superseded multi.zip run has now finished (500 ms) while the newer
    // run is still waiting (1500 ms). It must not re-enable the button or
    // restore its idle text under the newer run.
    await page.waitForTimeout(900);
    await expect(btn).toBeDisabled();
    await expect(btn).toContainText(/Processing|Extracting/);
    await expect(page.locator('#archive-results')).toHaveCount(0);

    await expect(page.locator('#archive-results')).toBeVisible({ timeout: 30000 });
    await expect(btn).toHaveText('Extract Files');
    await expect(btn).toBeEnabled();
  });

  test('clearing after a create leaves the button usable', async ({ page }) => {
    await page.goto('/create-zip');
    await page.locator('#file-input').setInputFiles([fixture('sample.png'), fixture('sample2.png')]);
    await page.locator('#action-btn').click();
    await expect(page.locator('#archive-results')).toBeVisible({ timeout: 30000 });

    await page.locator('#clear-all').click();
    await expect(page.locator('#file-list')).toBeEmpty();
    await expect(page.locator('#archive-results')).toHaveCount(0);

    await page.locator('#file-input').setInputFiles(fixture('sample.png'));
    await expect(page.locator('#action-btn')).toBeEnabled();
    await expect(page.locator('#action-btn')).toHaveText('Create ZIP');
  });
});
