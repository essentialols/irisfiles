import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

// Counts rows in the handoff store WITHOUT creating it, so the probe itself
// cannot manufacture the evidence it is looking for.
async function storedCount(page) {
  return page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    if (!dbs.some(d => d.name === 'irisfiles-active-file')) return -1; // db absent
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('irisfiles-active-file');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    if (!db.objectStoreNames.contains('active')) return 0;
    return new Promise((res, rej) => {
      const r = db.transaction('active', 'readonly').objectStore('active').count();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  });
}

test.describe('file-focus handoff store is not a persistent copy of user files', () => {
  test('selecting a file does not write it to disk', async ({ page }) => {
    await page.goto('/jpg-to-png');
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await expect(page.locator('#active-file-focus')).toBeVisible({ timeout: 15000 });

    // The panel is showing the file, but nothing should have been persisted:
    // merely looking at a tool must not leave bytes behind.
    await page.waitForTimeout(500);
    expect(await storedCount(page)).toBeLessThanOrEqual(0);
  });

  test('carrying a file to another tool still works and empties the store on arrival', async ({ page }) => {
    await page.goto('/jpg-to-png');
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await expect(page.locator('#active-file-focus')).toBeVisible({ timeout: 15000 });

    const link = page.locator('#active-file-focus [data-file-focus-route="/image-metadata"]').first();
    await expect(link).toBeVisible();
    await link.click();

    await page.waitForURL('**/image-metadata', { timeout: 15000 });

    // The feature must still work: the carried file is present on the new tool.
    await expect(page.locator('#active-file-focus')).toContainText('sample.jpg', { timeout: 15000 });

    // And the handoff store must be empty again now that it has been read.
    await page.waitForTimeout(750);
    expect(await storedCount(page)).toBeLessThanOrEqual(0);
  });

  test('nothing survives a fresh visit in the same profile', async ({ page }) => {
    await page.goto('/jpg-to-png');
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await expect(page.locator('#active-file-focus')).toBeVisible({ timeout: 15000 });
    await page.locator('#active-file-focus [data-file-focus-route="/image-metadata"]').first().click();
    await page.waitForURL('**/image-metadata', { timeout: 15000 });

    // Simulate the user coming back later rather than navigating onward.
    await page.goto('/jpg-to-png');
    await page.waitForTimeout(750);
    expect(await storedCount(page)).toBeLessThanOrEqual(0);
    await expect(page.locator('#active-file-focus')).toHaveCount(0);
  });
});
