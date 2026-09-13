import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

// Counts rows in BOTH handoff stores WITHOUT creating either, so the probe
// cannot manufacture the evidence it is looking for. Counting only
// irisfiles-active-file reported zero while a copy of the user's file could be
// sitting in irisfiles/pending, which made this a false negative.
const STORES = [
  ['irisfiles-active-file', 'active'],
  ['irisfiles', 'pending'],
];

async function storedCount(page) {
  return page.evaluate(async stores => {
    const present = (await indexedDB.databases()).map(d => d.name);
    let total = -1; // stays negative when neither database exists at all
    for (const [dbName, storeName] of stores) {
      if (!present.includes(dbName)) continue;
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open(dbName);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      if (total < 0) total = 0;
      if (db.objectStoreNames.contains(storeName)) {
        total += await new Promise((res, rej) => {
          const r = db.transaction(storeName, 'readonly').objectStore(storeName).count();
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
      }
      db.close();
    }
    return total;
  }, STORES);
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

  // The Smart Drop store had the same hole: rows were consumed by whichever page
  // loaded next, so a handoff the user abandoned surfaced in an unrelated tool.
  test('a Smart Drop handoff the user abandoned is not picked up by another tool', async ({ page }) => {
    await page.goto('/jpg-to-png');
    await page.locator('#file-input').setInputFiles(fixture('sample.jpg'));
    await expect(page.locator('#active-file-focus')).toBeVisible({ timeout: 15000 });

    // Write the handoff exactly as a route click does, then never go there.
    await page.evaluate(async () => {
      const { storePendingFiles } = await import('/js/pending-store.js');
      await storePendingFiles(Array.from(document.querySelector('#file-input').files), '/image-metadata');
    });

    await page.goto('/png-to-jpg');
    await page.waitForTimeout(750);
    await expect(page.locator('#file-list .file-item')).toHaveCount(0);
    await expect(page.locator('#active-file-focus')).toHaveCount(0);
    expect(await storedCount(page)).toBeLessThanOrEqual(0);
  });
});
