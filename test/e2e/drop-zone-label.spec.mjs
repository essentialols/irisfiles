import { test, expect } from '@playwright/test';

// The drop-zone label is "... or <strong>click to browse</strong>" and the pill
// styling makes that paragraph a flex container, which turns the text and the
// <strong> into separate items and discards the whitespace between them. Without
// an explicit gap it renders as "orclick to browse" on every page.
const PAGES = ['/', '/jpg-to-png', '/merge-pdf', '/mp3-to-wav'];

for (const route of PAGES) {
  test(`drop-zone label keeps a visible space before the browse text on ${route}`, async ({ page }) => {
    await page.goto(route);
    const label = page.locator('#smart-drop > p, #drop-zone > p').filter({ hasText: 'click to browse' }).first();
    await expect(label).toBeVisible();

    const gapPx = await label.evaluate(node => {
      const strong = node.querySelector('strong');
      const range = document.createRange();
      range.setStart(node.firstChild, 0);
      range.setEnd(node.firstChild, node.firstChild.nodeValue.length);
      return strong.getBoundingClientRect().left - range.getBoundingClientRect().right;
    });

    expect(gapPx).toBeGreaterThan(1);
  });
}
