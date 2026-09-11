import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

test.describe('Create ZIP result freshness', () => {
  test('adding a file invalidates the old archive and the recreated ZIP includes it', async ({ page }) => {
    await page.goto('/create-zip');

    await page.locator('#file-input').setInputFiles([
      fixture('sample.png'),
      fixture('sample.pdf'),
    ]);
    await page.locator('#action-btn').click();
    await expect(page.locator('#archive-results #dl-zip')).toBeVisible();

    // The existing result was built from two files. Once the queue changes it
    // must not remain downloadable as though it represented the current list.
    await page.locator('#file-input').setInputFiles(fixture('sample.txt'));
    await expect(page.locator('#file-list .file-item')).toHaveCount(3);
    await expect(page.locator('#archive-results')).toHaveCount(0);

    await page.locator('#action-btn').click();
    await expect(page.locator('#archive-results #dl-zip')).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#dl-zip').click(),
    ]);
    const output = await readFile(await download.path());
    const names = await page.evaluate(bytes => {
      const entries = fflate.unzipSync(Uint8Array.from(bytes));
      return Object.keys(entries).sort();
    }, Array.from(output));

    expect(names).toEqual(['sample.pdf', 'sample.png', 'sample.txt']);
  });
});
