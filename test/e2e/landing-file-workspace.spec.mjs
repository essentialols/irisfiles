import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

test.describe('Landing active-file workspace', () => {
  test('uses the rich Smart Drop card as the single visible workspace', async ({ page }) => {
    await page.goto('/');
    await page.locator('#smart-file-input').setInputFiles(fixture('sample.mp4'));

    const workspace = page.locator('#route-panel');
    await expect(workspace).toBeVisible();
    await expect(workspace.locator('.route-file-name')).toHaveText('sample.mp4');
    await expect(workspace.locator('.route-preview')).toBeVisible();
    await expect(workspace.getByRole('button', { name: 'Choose another' })).toBeVisible();

    // The generic persistent bar and the large picker must not duplicate the
    // file identity/actions once Smart Drop owns the current file.
    await expect(page.locator('#active-file-focus')).toHaveCount(0);
    await expect(page.locator('#smart-drop')).toBeHidden();

    // Native routes stay singular even though the persistent action matrix is
    // used to fill Smart Drop gaps.
    await expect(workspace.locator('[data-href="/mp4-to-webm"]')).toHaveCount(1);
    await expect(workspace.locator('[data-href="/create-zip"]')).toHaveCount(1);
  });

  test('supplemental actions still carry the original file to another tool', async ({ page }) => {
    await page.goto('/');
    await page.locator('#smart-file-input').setInputFiles(fixture('sample.mp4'));

    const workspace = page.locator('#route-panel');
    const zip = workspace.locator('[data-href="/create-zip"]');
    await expect(zip).toBeVisible();
    await zip.click();

    await expect(page).toHaveURL(/\/create-zip$/);
    // Assert the file itself arrived, not the file-focus panel. The destination's
    // own loadPendingFiles() clears the pending store as it consumes it, so
    // file-focus's peek finds nothing and never renders a panel here.
    await expect(page.locator('.file-item')).toHaveCount(1);
    await expect(page.locator('.file-item__name')).toHaveText('sample.mp4');
  });

  test('dismissing the active file restores the landing picker', async ({ page }) => {
    await page.goto('/');
    await page.locator('#smart-file-input').setInputFiles(fixture('sample.mp4'));

    const workspace = page.locator('#route-panel');
    await expect(page.locator('#smart-drop')).toBeHidden();
    await workspace.locator('.route-dismiss').click();

    await expect(workspace).toBeHidden();
    await expect(page.locator('#smart-drop')).toBeVisible();
    await expect(page.locator('#active-file-focus')).toHaveCount(0);
  });

  test('Smart Drop dismiss control has a finger-sized hit area on phones', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const input = page.locator('#smart-file-input');
    const dismiss = page.locator('#route-panel .route-dismiss');
    // The 44px area is a pseudo-element, which boundingBox() ignores, so probe
    // where a finger would land: the four corners of a 44px square on the button.
    const cornersHit = () => dismiss.evaluate(el => {
      const r = el.getBoundingClientRect();
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      return [[-21, -21], [21, -21], [-21, 21], [21, 21]]
        .map(([dx, dy]) => document.elementFromPoint(cx + dx, cy + dy)?.closest('.route-dismiss') === el);
    });

    await input.setInputFiles(fixture('sample.avif'));
    await expect(dismiss).toBeVisible();
    expect(await cornersHit()).toEqual([true, true, true, true]);

    // The mixed-types panel is a separate render path with its own dismiss button.
    await input.setInputFiles([fixture('sample.png'), fixture('sample.pdf')]);
    await expect(page.locator('#route-panel')).toContainText('Mixed file types');
    expect(await cornersHit()).toEqual([true, true, true, true]);
  });

  test('dismissing the file while the handoff write is in flight cancels the navigation', async ({ page }) => {
    await page.goto('/');
    await page.locator('#smart-file-input').setInputFiles(fixture('sample.mp4'));

    // /video-metadata is a native Smart Drop route (not one of the persistent
    // action-matrix buttons layered on top, which has no selectionToken of its
    // own), and it isn't inline-resolvable, so its click handler is the one
    // that awaits the pending-store write before navigating.
    const workspace = page.locator('#route-panel');
    const metadata = workspace.locator('[data-href="/video-metadata"]');
    await expect(metadata).toBeVisible();

    // The route click's handler awaits an IndexedDB write, then only checked
    // whether the click itself was stale, not whether the selection changed
    // underneath it. Firing both clicks synchronously in one page turn lands
    // the dismiss's selectionToken bump before that write's promise settles,
    // which is exactly the ordering a fast second drop produced in production.
    await page.evaluate(() => {
      document.querySelector('[data-href="/video-metadata"]').click();
      document.querySelector('.route-dismiss').click();
    });

    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/$/);

    // The write itself must also have been unwound, not just the navigation
    // skipped, or the abandoned file would still be waiting for whoever visits
    // /video-metadata next.
    await page.goto('/video-metadata');
    await page.waitForTimeout(500);
    await expect(page.locator('.file-item')).toHaveCount(0);
  });
});
