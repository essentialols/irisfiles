import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

async function installPdfReadGate(page) {
  await page.addInitScript(() => {
    const original = File.prototype.arrayBuffer;
    window.__pdfReads = [];
    File.prototype.arrayBuffer = function (...args) {
      window.__pdfReads.push(this.name);
      if (!window.__releasePdfRead) {
        return new Promise((resolve, reject) => {
          window.__releasePdfRead = () => original.apply(this, args).then(resolve, reject);
        });
      }
      return original.apply(this, args);
    };
  });
}

async function addNamedPdfs(page, names) {
  const pdf = await readFile(fixture('sample.pdf'));
  await page.locator('#file-input').setInputFiles(names.map(name => ({
    name,
    mimeType: 'application/pdf',
    buffer: pdf,
  })));
}

test.describe('PDF operations remain consistent during file-list changes', () => {
  test('merge reads the original file snapshot and cannot be started twice', async ({ page }) => {
    await installPdfReadGate(page);
    await page.goto('/merge-pdf');
    await addNamedPdfs(page, ['alpha.pdf', 'beta.pdf', 'gamma.pdf']);

    await page.locator('#action-btn').click();
    await expect.poll(() => page.evaluate(() => typeof window.__releasePdfRead)).toBe('function');
    await page.locator('.btn-remove').first().click();

    await expect(page.locator('#action-btn')).toBeDisabled();
    await page.evaluate(() => window.__releasePdfRead());
    await expect(page.locator('#dl-single')).toBeVisible({ timeout: 15000 });
    await expect.poll(() => page.evaluate(() => window.__pdfReads)).toEqual([
      'alpha.pdf',
      'beta.pdf',
      'gamma.pdf',
    ]);
  });

  test('clear during a merge prevents the stale result from appearing', async ({ page }) => {
    await installPdfReadGate(page);
    await page.goto('/merge-pdf');
    await addNamedPdfs(page, ['alpha.pdf', 'beta.pdf']);

    await page.locator('#action-btn').click();
    await expect.poll(() => page.evaluate(() => typeof window.__releasePdfRead)).toBe('function');
    await page.locator('#clear-all').click();
    await page.evaluate(() => window.__releasePdfRead());

    await expect(page.locator('#action-btn')).toHaveText('Merge PDFs', { timeout: 15000 });
    await expect(page.locator('#pdf-results')).toHaveCount(0);
  });
});

test('resize does not retry a file rejected by size validation', async ({ page }) => {
  await page.goto('/resize-image');
  await page.evaluate(async () => {
    const png = await fetch('/test/fixtures/sample.png').then(response => response.arrayBuffer());
    const oversized = new File([png], 'oversized.png', { type: 'image/png' });
    Object.defineProperty(oversized, 'size', { value: 101 * 1024 * 1024 });
    const valid = new File([png], 'valid.png', { type: 'image/png' });
    Object.defineProperty(document.getElementById('file-input'), 'files', {
      configurable: true,
      value: [oversized, valid],
    });
    document.getElementById('file-input').dispatchEvent(new Event('change'));
  });

  const oversizedItem = page.locator('.file-item').filter({ hasText: 'oversized.png' });
  await expect(oversizedItem.locator('.file-item__status.error')).toContainText('too large');
  await page.locator('#resize-btn').click();
  await expect(page.locator('.file-item').filter({ hasText: 'valid.png' })).toHaveClass(/done/, { timeout: 10000 });
  await expect(oversizedItem.locator('.file-item__status.error')).toContainText('too large');
});

test.describe('image frame drag validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/images-to-gif');
    await page.locator('#file-input').setInputFiles([fixture('sample.png'), fixture('sample2.png')]);
    await expect(page.locator('.frame-item')).toHaveCount(2);
  });

  test('ignores external numeric text drops', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const namesBefore = await page.locator('.frame-item__name').allTextContents();

    await page.locator('.frame-item').nth(1).evaluate(target => {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', '99');
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    });

    await expect(page.locator('.frame-item')).toHaveCount(2);
    await expect(page.locator('.frame-item__name')).toHaveText(namesBefore);
    expect(errors).toEqual([]);
  });

  test('still reorders a valid internal frame drag', async ({ page }) => {
    const namesBefore = await page.locator('.frame-item__name').allTextContents();
    await page.locator('.frame-item').first().dragTo(page.locator('.frame-item').nth(1));
    await expect(page.locator('.frame-item__name')).toHaveText(namesBefore.reverse());
  });
});

test('batch ZIP failure reports the error and restores Download All', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/png-to-jpg');
  await page.locator('#file-input').setInputFiles([fixture('sample.png'), fixture('sample2.png')]);
  await page.locator('.file-item.done').nth(1).waitFor({ timeout: 15000 });
  await page.evaluate(() => { window.fflate = undefined; });

  const downloadAll = page.locator('#download-all');
  await downloadAll.click();

  await expect(page.locator('#cf-notice')).toContainText('ZIP library not loaded');
  await expect(downloadAll).toBeEnabled();
  await expect(downloadAll).toHaveText('Download All as ZIP');
  expect(errors).toEqual([]);
});
