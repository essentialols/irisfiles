import { test, expect } from '@playwright/test';

async function installControlledHtmlPdfRenderer(page, delayedName) {
  await page.evaluate(nameToHold => {
    const originalText = File.prototype.text;
    let releaseRead = null;
    window.__htmlReadHeld = false;
    window.__htmlPdfOutputCount = 0;
    window.__releaseHtmlRead = () => releaseRead?.();

    File.prototype.text = function () {
      if (this.name !== nameToHold) return originalText.call(this);
      return new Promise(resolve => {
        window.__htmlReadHeld = true;
        releaseRead = () => originalText.call(this).then(resolve);
      });
    };

    window.html2canvas = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 120;
      canvas.height = 80;
      return canvas;
    };

    class FakeJsPDF {
      constructor() {
        this.internal = { pageSize: { getWidth: () => 595, getHeight: () => 842 } };
      }
      addPage() {}
      addImage() {}
      output() {
        window.__htmlPdfOutputCount += 1;
        return new Blob(['%PDF-1.4\n% deterministic HTML ownership test\n%%EOF\n'], { type: 'application/pdf' });
      }
    }
    window.jspdf = { jsPDF: FakeJsPDF };
  }, delayedName);
}

test.describe('HTML to PDF operation ownership', () => {
  test('replacing the source discards the older conversion result', async ({ page }) => {
    await page.goto('/html-to-pdf');
    await installControlledHtmlPdfRenderer(page, 'first.html');

    await page.locator('#file-input').setInputFiles({
      name: 'first.html',
      mimeType: 'text/html',
      buffer: Buffer.from('<!doctype html><h1>First document</h1>'),
    });
    await page.locator('#action-btn').click();
    await expect.poll(() => page.evaluate(() => window.__htmlReadHeld)).toBe(true);

    await page.locator('#file-input').setInputFiles({
      name: 'second.html',
      mimeType: 'text/html',
      buffer: Buffer.from('<!doctype html><h1>Second document</h1>'),
    });

    await expect(page.locator('#file-list .file-item__name')).toHaveText('second.html');
    await expect(page.locator('#action-btn')).toBeEnabled();
    await expect(page.locator('#action-btn')).toHaveText('Convert to PDF');
    await expect(page.locator('#html-pdf-result .file-item')).toHaveCount(0);

    await page.evaluate(() => window.__releaseHtmlRead());
    await expect.poll(() => page.evaluate(() => window.__htmlPdfOutputCount)).toBe(1);

    await expect(page.locator('#file-list .file-item__name')).toHaveText('second.html');
    await expect(page.locator('#html-pdf-result .file-item')).toHaveCount(0);
    await expect(page.locator('#action-btn')).toBeEnabled();
    await expect(page.locator('#action-btn')).toHaveText('Convert to PDF');

    await page.locator('#action-btn').click();
    await expect.poll(() => page.evaluate(() => window.__htmlPdfOutputCount)).toBe(2);
    await expect(page.locator('#html-pdf-result .file-item__name')).toHaveText('second.pdf');
    await expect(page.locator('#html-pdf-download')).toBeVisible();
  });

  test('clearing while rendering cannot publish a stale result or error', async ({ page }) => {
    await page.goto('/html-to-pdf');
    await installControlledHtmlPdfRenderer(page, 'clear-me.html');

    await page.locator('#file-input').setInputFiles({
      name: 'clear-me.html',
      mimeType: 'text/html',
      buffer: Buffer.from('<!doctype html><h1>Clear this document</h1>'),
    });
    await page.locator('#action-btn').click();
    await expect.poll(() => page.evaluate(() => window.__htmlReadHeld)).toBe(true);

    await page.locator('#clear-all').click();
    await expect(page.locator('#file-list .file-item')).toHaveCount(0);
    await expect(page.locator('#action-btn')).toBeHidden();
    await expect(page.locator('#html-pdf-result .file-item')).toHaveCount(0);

    await page.evaluate(() => window.__releaseHtmlRead());
    await expect.poll(() => page.evaluate(() => window.__htmlPdfOutputCount)).toBe(1);

    await expect(page.locator('#file-list .file-item')).toHaveCount(0);
    await expect(page.locator('#html-pdf-result .file-item')).toHaveCount(0);
    await expect(page.locator('#html-pdf-notice')).toHaveCount(0);
    await expect(page.locator('#action-btn')).toBeHidden();
  });
});
