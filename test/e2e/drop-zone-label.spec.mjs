import { test, expect } from '@playwright/test';

// The pill styling makes this paragraph a flex container, and a flex container
// discards whitespace between items. When the label was split into a text node
// plus a <strong>, that turned "or click to browse" into "orclick to browse" on
// every page. Asserting the rendered text catches that however it is reproduced.
const PAGES = ['/', '/jpg-to-png', '/merge-pdf', '/mp3-to-wav'];

for (const route of PAGES) {
  test(`drop-zone label reads as one spaced sentence on ${route}`, async ({ page }) => {
    await page.goto(route);
    const label = page.locator('#smart-drop > p, #drop-zone > p').filter({ hasText: 'click to browse' }).first();
    await expect(label).toBeVisible();

    expect(await label.innerText()).toMatch(/\bor click to browse\b/);
  });
}
