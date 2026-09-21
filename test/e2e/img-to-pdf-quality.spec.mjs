import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fixture } from './helpers.mjs';

// #196 threaded getQuality() into imagesToPdf, but no image-to-PDF page shipped
// a #quality-slider, so getQuality() always returned its 0.92 fallback and the
// output was byte-identical at every setting. These assert the control exists
// and that moving it actually changes the PDF.
async function pdfBytesAtQuality(page, path, file, quality) {
  await page.goto(path);
  await page.locator('#file-input').setInputFiles(file);
  await page.locator('#quality-slider').evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, quality);
  await page.locator('#action-btn').click();
  await page.locator('#pdf-results #dl-single').waitFor({ timeout: 60_000 });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#pdf-results #dl-single').click(),
  ]);
  return (await readFile(await download.path())).length;
}

test.describe('image to PDF quality control', () => {
  test('the slider changes the produced PDF', async ({ page }) => {
    // A 4K photo: enough real detail that the quality setting dominates the
    // output size. Before the slider existed both runs were byte-identical.
    const low = await pdfBytesAtQuality(page, '/jpg-to-pdf', fixture('large-4k.jpg'), '10');
    const high = await pdfBytesAtQuality(page, '/jpg-to-pdf', fixture('large-4k.jpg'), '100');
    expect(low).toBeLessThan(high * 0.5);
  });

  test('every lossy image-to-PDF page offers the control', async ({ page }) => {
    for (const path of ['/jpg-to-pdf', '/webp-to-pdf', '/avif-to-pdf', '/heic-to-pdf',
      '/bmp-to-pdf', '/gif-to-pdf', '/ico-to-pdf', '/tiff-to-pdf', '/svg-to-pdf']) {
      await page.goto(path);
      await expect(page.locator('#quality-slider'), `${path} should offer quality`).toHaveCount(1);
    }
  });

  test('png-to-pdf offers no control because a PNG source is embedded losslessly', async ({ page }) => {
    await page.goto('/png-to-pdf');
    await expect(page.locator('#quality-slider')).toHaveCount(0);
  });
});
