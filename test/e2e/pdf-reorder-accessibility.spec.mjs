import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

async function cardOrder(page) {
  return page.locator('.pdf-page-card').evaluateAll(cards =>
    cards.map(card => card.querySelector('.pdf-page-card__footer span')?.textContent?.trim())
  );
}

test.describe('Reorder PDF accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/reorder-pdf-pages');
    await page.locator('#file-input').setInputFiles(fixture('multi-page.pdf'));
    await expect(page.locator('.pdf-page-card')).toHaveCount(3, { timeout: 15000 });
  });

  test('move buttons reorder pages and preserve keyboard focus', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Move page 1 earlier' })).toBeDisabled();
    const moveLater = page.getByRole('button', { name: 'Move page 1 later' });
    await moveLater.focus();
    await page.keyboard.press('Enter');
    expect(await cardOrder(page)).toEqual(['Page 2', 'Page 1', 'Page 3']);
    await expect(page.getByRole('button', { name: 'Move page 1 later' })).toBeFocused();
  });

  test('mobile move controls are touch sized and reorder without drag', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const moveLater = page.getByRole('button', { name: 'Move page 1 later' });
    const box = await moveLater.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);

    await moveLater.click();
    expect(await cardOrder(page)).toEqual(['Page 2', 'Page 1', 'Page 3']);

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
