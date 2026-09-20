import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('Expected PNG output');
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function convertSvgToPng(page, svg, name = 'input.svg', mimeType = 'image/svg+xml') {
  await page.goto('/svg-to-png');
  await page.locator('#file-input').setInputFiles({
    name,
    mimeType,
    buffer: Buffer.from(svg),
  });
  await page.locator('.file-item.done').waitFor({ timeout: 15_000 });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.btn-download').click(),
  ]);
  return pngDimensions(await readFile(await download.path()));
}

test.describe('SVG raster dimensions', () => {
  test('viewBox-only SVG uses its viewBox dimensions instead of the browser 300x150 fallback', async ({ page }) => {
    const dimensions = await convertSvgToPng(page, `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400">
        <rect width="800" height="400" fill="#0f172a"/>
        <circle cx="200" cy="200" r="120" fill="#22c55e"/>
      </svg>
    `, 'viewbox-only.svg', 'application/octet-stream');

    expect(dimensions).toEqual({ width: 800, height: 400 });
  });

  test('explicit SVG width and height remain authoritative', async ({ page }) => {
    const dimensions = await convertSvgToPng(page, `
      <svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 600 400">
        <rect width="600" height="400" fill="#ef4444"/>
      </svg>
    `);

    expect(dimensions).toEqual({ width: 120, height: 80 });
  });

  test('SVG to PDF uses viewBox sizing while keeping explicit dimensions authoritative', async ({ page }) => {
    await page.goto('/svg-to-pdf');
    await page.locator('#file-input').setInputFiles([
      {
        name: 'viewbox-only.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(`
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400">
            <rect width="800" height="400" fill="#0f172a"/>
            <circle cx="200" cy="200" r="120" fill="#22c55e"/>
          </svg>
        `),
      },
      {
        name: 'explicit-landscape.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(`
          <svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 600 400">
            <rect width="600" height="400" fill="#ef4444"/>
          </svg>
        `),
      },
      {
        name: 'explicit-portrait.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(`
          <svg xmlns="http://www.w3.org/2000/svg" width="80" height="120" viewBox="0 0 400 600">
            <rect width="400" height="600" fill="#3b82f6"/>
          </svg>
        `),
      },
    ]);

    await page.locator('#action-btn').click();
    await expect(page.locator('#pdf-results .file-item.done')).toBeVisible({ timeout: 30_000 });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#dl-single').click(),
    ]);

    const pdf = await PDFDocument.load(await readFile(await download.path()));
    const sizes = pdf.getPages().map(pdfPage => pdfPage.getSize());

    // jsPDF's px_scaling hotfix maps CSS px to PDF points at 72/96.
    expect(sizes).toHaveLength(3);
    expect(sizes[0].width).toBeCloseTo(600, 1);
    expect(sizes[0].height).toBeCloseTo(300, 1);
    expect(sizes[1].width).toBeCloseTo(90, 1);
    expect(sizes[1].height).toBeCloseTo(60, 1);
    expect(sizes[2].width).toBeCloseTo(60, 1);
    expect(sizes[2].height).toBeCloseTo(90, 1);
  });

  // Rasterizing at the viewBox size sent that size straight into
  // validateDimensions(), so a viewBox past the 100MP canvas budget started
  // throwing. An SVG is resolution-independent, so it is scaled to fit instead.
  test('a viewBox larger than the 100MP budget is scaled down, not rejected', async ({ page }) => {
    await page.goto('/svg-to-png');
    await page.locator('#file-input').setInputFiles(fixture('huge-viewbox.svg'));
    await expect(page.locator('.file-item').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.file-item.done').first()).toBeVisible({ timeout: 90000 });
    await expect(page.locator('.file-item').first()).not.toContainText(/too large/i);
  });

  // jsPDF clamps any page over 14400 units and says so on the console, but
  // addImage still drew at the requested size, so the overflow was cropped. The
  // first page escaped the clamp entirely (it assigns pageSize directly), which
  // also left a batch with mismatched page widths.
  test('a viewBox wider than one PDF page is scaled to fit rather than cropped', async ({ page }) => {
    const wide = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24000 100"><rect width="24000" height="100" fill="#111827"/></svg>`;
    await page.goto('/svg-to-pdf');
    await page.locator('#file-input').setInputFiles([
      { name: 'wide-1.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(wide) },
      { name: 'wide-2.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(wide) },
    ]);

    await page.locator('#action-btn').click();
    await expect(page.locator('#pdf-results .file-item.done')).toBeVisible({ timeout: 30_000 });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#dl-single').click(),
    ]);

    const pdf = await PDFDocument.load(await readFile(await download.path()));
    const sizes = pdf.getPages().map(p => p.getSize());
    expect(sizes).toHaveLength(2);
    for (const { width, height } of sizes) {
      expect(width).toBeLessThanOrEqual(14400);
      expect(height).toBeLessThanOrEqual(14400);
      // 24000x100 is 240:1, and scaling to fit has to keep that.
      expect(width / height).toBeCloseTo(240, 0);
    }
    // Both pages take the same path, so neither may escape the limit.
    expect(sizes[0].width).toBeCloseTo(sizes[1].width, 1);
  });

  test('SVGs with linked external images fail instead of silently omitting them', async ({ page }) => {
    await page.goto('/svg-to-png');
    await page.locator('#file-input').setInputFiles({
      name: 'Résumé_日本語_linked.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(`
        <svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">
          <rect width="120" height="80" fill="#fff"/>
          <image href="https://example.invalid/photo.png" width="120" height="80"/>
        </svg>
      `),
    });

    const item = page.locator('.file-item').first();
    await expect(item.locator('.file-item__status.error')).toContainText(/references external files/i);
    await expect(item.locator('.btn-download')).toHaveCount(0);
  });

  test('embedded data images and fragment references remain convertible', async ({ page }) => {
    const redPng = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAk+Uzr4AAAAASUVORK5CYII=';
    const dimensions = await convertSvgToPng(page, `
      <svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">
        <defs><rect id="marker" width="20" height="20" fill="#2563eb"/></defs>
        <image href="data:image/png;base64,${redPng}" width="120" height="80"/>
        <use href="#marker" x="5" y="5"/>
      </svg>
    `, 'embedded.svg');

    expect(dimensions).toEqual({ width: 120, height: 80 });
  });

});
