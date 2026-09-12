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
});
