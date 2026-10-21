import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

// An agent driving /heic-to-jpg from an accessibility snapshot could never
// upload a file: the input was display:none so it had no node in the tree, and
// the only upload-looking element was the drop zone wrapper carrying
// role="button" with the <h1>, the tagline, the icon, the instruction and the
// disclaimer inside it. Its role-and-name ref matched several elements, so the
// upload action failed with "Matched multiple elements".
//
// The contract now: one file input per converter page, in the accessibility
// tree, with an accessible name, and no heading inside a control.
const PAGES = [
  { route: '/heic-to-jpg', label: 'Choose HEIC files', accept: '.heic', multiple: true },
  { route: '/png-to-jpg', label: 'Choose PNG files', accept: '.png', multiple: true },
  { route: '/merge-pdf', label: 'Choose PDF files', accept: '.pdf', multiple: true },
  { route: '/html-to-pdf', label: 'Choose an HTML file', accept: '.html', multiple: false },
  { route: '/', label: 'Choose any file', accept: '.heic', multiple: true },
];

for (const page_ of PAGES) {
  test(`${page_.route} exposes exactly one named file input`, async ({ page }) => {
    await page.goto(page_.route);
    await page.waitForLoadState('networkidle');

    expect(await page.evaluate(() => document.querySelectorAll('input[type=file]').length)).toBe(1);

    const input = page.locator('input[type=file]');
    await expect(input).toHaveAttribute('aria-label', page_.label);
    expect(await input.getAttribute('accept')).toContain(page_.accept);
    expect(await input.evaluate(node => node.multiple)).toBe(page_.multiple);

    // Present in the accessibility tree, which display:none prevented.
    expect(await input.evaluate(node => getComputedStyle(node).display)).not.toBe('none');

    // One control, resolvable by its accessible name without a strict-mode
    // violation, and no heading nested inside any control.
    await expect(page.getByLabel(page_.label)).toHaveCount(1);
    expect(await page.evaluate(() => document.querySelectorAll(
      'button :is(h1,h2,h3), [role=button] :is(h1,h2,h3)',
    ).length)).toBe(0);
  });
}

test('the exposed input still accepts a HEIC file and produces a JPG', async ({ page }) => {
  await page.goto('/heic-to-jpg');
  await page.waitForLoadState('networkidle');

  await page.getByLabel('Choose HEIC files').setInputFiles(fixture('sample.heic'));

  const button = page.locator('.btn-download').first();
  await expect(button).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.file-item__name').first()).toContainText('sample.heic');

  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  expect(download.suggestedFilename()).toMatch(/\.jpe?g$/i);
  const bytes = await readFile(await download.path());
  // SOI + JFIF: the produced file really is a JPEG, not a renamed HEIC.
  expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
});

test('the drop zone still opens the picker on click and takes a drop', async ({ page }) => {
  await page.goto('/png-to-jpg');
  await page.waitForLoadState('networkidle');

  // Click-to-browse: one picker, not two, now that the input is clickable.
  const choosers = [];
  page.on('filechooser', chooser => choosers.push(chooser));
  await page.locator('#drop-zone').click({ position: { x: 10, y: 10 } });
  await expect.poll(() => choosers.length).toBe(1);
  await page.waitForTimeout(250);
  expect(choosers.length).toBe(1);

  // Drag-and-drop still reaches the page's drop handler.
  await page.locator('#drop-zone').dispatchEvent('drop', {
    dataTransfer: await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'dropped.png', { type: 'image/png' }));
      return dt;
    }),
  });
  await expect(page.locator('.file-item__name')).toContainText('dropped.png');
});
