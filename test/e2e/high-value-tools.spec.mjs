import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { fixture, cacheCdnAssets, buildApng } from './helpers.mjs';

// Each test gets a fresh context, so each one refetched the ~25MB FFmpeg core.
test.beforeEach(async ({ page }) => { await cacheCdnAssets(page); });

test.describe('High-value tool expansion', () => {
  test('landing exposes the new tool families', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('a[href="/mp4-to-mp3"]')).toBeVisible();
    await expect(page.locator('a[href="/background-remover"]')).toBeVisible();
    await expect(page.locator('a[href="/image-to-text"]')).toBeVisible();
    await expect(page.locator('a[href="/png-to-ico"]')).toBeVisible();
    await expect(page.locator('a[href="/compress-pdf"]')).toBeVisible();
    await expect(page.locator('a[href="/html-to-pdf"]')).toBeVisible();
  });

  test('smart drop adds video-to-audio destinations without replacing existing routes', async ({ page }) => {
    await page.goto('/');
    await page.locator('#smart-file-input').setInputFiles(fixture('sample.mp4'));

    await expect(page.locator('.route-option[data-href="/mp4-to-mp3"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.route-option[data-href="/mp4-to-wav"]')).toBeVisible();
    await expect(page.locator('.route-option[data-href="/mp4-to-webm"]')).toBeVisible();
  });

  test('smart drop offers background removal for an image', async ({ page }) => {
    await page.goto('/');
    await page.locator('#smart-file-input').setInputFiles(fixture('sample.png'));

    await expect(page.locator('.route-option[data-href="/background-remover"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.route-option[data-href="/image-to-text"]')).toBeVisible();
  });

  test('MP4 to MP3 converts a sample video', async ({ page }) => {
    await page.goto('/mp4-to-mp3');
    await page.locator('#file-input').setInputFiles(fixture('sample.mp4'));

    await expect(page.locator('.file-item.done')).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('.file-item.done .btn--success')).toBeVisible();
  });

  test('PNG to ICO creates a downloadable ICO', async ({ page }) => {
    await page.goto('/png-to-ico');
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));

    await expect(page.locator('.file-item.done')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.file-item.done .btn--success')).toBeVisible();
    await expect(page.locator('.file-item__meta')).toContainText('→');
  });

  test('PNG to ICO refuses animated PNG before flattening it', async ({ page }) => {
    await page.goto('/png-to-ico');
    await page.locator('#file-input').setInputFiles({
      name: 'animated.png',
      mimeType: 'image/png',
      buffer: await buildApng(),
    });

    const item = page.locator('.file-item').first();
    await expect(item).toHaveClass(/failed/);
    await expect(item.locator('.file-item__meta')).toContainText('Animated PNG (APNG)');
    await expect(item.locator('.btn--success')).toHaveCount(0);
    await expect(item.locator('.rm')).toBeVisible();
  });

  test('PNG to ICO tells the user when the 50-file batch limit drops inputs', async ({ page }) => {
    await page.goto('/png-to-ico');
    const source = await readFile(fixture('sample.png'));
    const inputs = Array.from({ length: 51 }, (_, index) => ({
      name: `icon-${index + 1}.png`,
      mimeType: 'image/png',
      buffer: source,
    }));

    await page.locator('#file-input').setInputFiles(inputs);

    await expect(page.locator('.file-item')).toHaveCount(50);
    await expect(page.locator('#ico-notice .notice__text')).toHaveText('Only added 50 of 51 files (batch limit: 50).');
  });

  test('background remover exposes quality, refinement, and manual cleanup UI', async ({ page }) => {
    await page.goto('/background-remover');
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));

    await expect(page.locator('#action-btn')).toBeVisible();
    await expect(page.locator('#bg-quality')).toHaveValue('auto');
    await expect(page.locator('#edge-refinement')).toHaveValue('normal');
    await expect(page.locator('#bg-editor')).toBeHidden();
    await expect(page.locator('.file-item__name')).toContainText('sample.png');
  });

  test('fast background removal produces an editable transparent cutout', async ({ page }) => {
    test.slow();
    await page.goto('/background-remover');
    await page.locator('#bg-quality').selectOption('fast');
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));
    await page.locator('#action-btn').click();

    await expect(page.locator('#bg-editor')).toBeVisible({ timeout: 90_000 });
    await expect(page.locator('#download-transparent')).toBeVisible();
    await expect(page.locator('#brush-erase')).toBeVisible();
    await expect(page.locator('#brush-restore')).toBeVisible();
    await expect.poll(async () => page.locator('#bg-preview-canvas').evaluate(canvas => canvas.width * canvas.height)).toBeGreaterThan(0);
  });

  test('image OCR page accepts a supported image without uploading it', async ({ page }) => {
    await page.goto('/image-to-text');
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));

    await expect(page.locator('#action-btn')).toBeVisible();
    await expect(page.locator('#ocr-lang')).toBeVisible();
    await expect(page.locator('.file-item__name')).toContainText('sample.png');
  });

  test('rotate PDF previews rotation, preserves focus, and avoids no-op saves', async ({ page }) => {
    await page.goto('/rotate-pdf');
    await page.locator('#file-input').setInputFiles(fixture('sample.pdf'));

    const firstPage = page.locator('.pdf-page-card').first();
    const actionBtn = page.locator('#action-btn');
    await expect(firstPage).toBeVisible({ timeout: 15_000 });
    await expect(actionBtn).toBeDisabled();

    const rotateButton = firstPage.getByRole('button', { name: /Rotate page 1 90 degrees clockwise/ });
    await rotateButton.focus();
    await rotateButton.press('Enter');
    await expect(rotateButton).toBeFocused();
    await expect(firstPage.locator('.pdf-page-card__badge')).toHaveText('90°');
    await expect(rotateButton).toHaveAttribute('aria-label', /Current rotation 90 degrees/);
    expect(await firstPage.locator('img').evaluate(img => img.style.transform)).toBe('rotate(90deg)');
    await expect(actionBtn).toBeEnabled();

    for (let i = 0; i < 3; i++) await rotateButton.press('Enter');
    await expect(rotateButton).toBeFocused();
    await expect(firstPage.locator('.pdf-page-card__badge')).toHaveText('0°');
    expect(await firstPage.locator('img').evaluate(img => img.style.transform)).toBe('rotate(0deg)');
    await expect(actionBtn).toBeDisabled();

    await rotateButton.press('Enter');
    await actionBtn.click();
    await expect(page.locator('#pdf-tool-result .btn--success')).toBeVisible({ timeout: 15_000 });
  });

  test('PDF to text extracts embedded text', async ({ page }) => {
    await page.goto('/pdf-to-text');
    await page.locator('#file-input').setInputFiles(fixture('sample.pdf'));
    await page.locator('#action-btn').click();

    const output = page.locator('#pdf-text-result');
    await expect(output).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await output.inputValue()).trim().length).toBeGreaterThan(0);
  });

  test('PDF compression always produces a safe result, even when original is smaller', async ({ page }) => {
    await page.goto('/compress-pdf');
    await page.locator('#file-input').setInputFiles(fixture('sample.pdf'));
    await page.locator('#action-btn').click();

    await expect(page.locator('#pdf-tool-result .btn--success')).toBeVisible({ timeout: 20_000 });
  });

  // File.arrayBuffer is the first async step of every run, so parking it lets a test replace the file
  // at an exact point instead of racing timers. Set window.__holdSpec[name] = n to park that file's nth
  // call; window.__held(name) says whether it is parked and window.__release(name) lets it continue.
  const holdArrayBuffer = () => {
    const original = File.prototype.arrayBuffer;
    const calls = {}; const parked = {}; const resolvers = {};
    window.__holdSpec = {};
    window.__held = (name) => !!parked[name];
    window.__release = (name) => { parked[name] = false; resolvers[name]?.(); };
    File.prototype.arrayBuffer = function (...args) {
      const n = calls[this.name] = (calls[this.name] || 0) + 1;
      if (window.__holdSpec[this.name] !== n) return original.apply(this, args);
      parked[this.name] = true;
      return new Promise((resolve, reject) => {
        resolvers[this.name] = () => original.apply(this, args).then(resolve, reject);
      });
    };
  };

  test('replacing a PDF during compression stops the stale run early and keeps the button disabled', async ({ page }) => {
    const source = await readFile(fixture('sample.pdf'));
    await page.addInitScript(holdArrayBuffer);
    // Every compressed page goes through canvas.toBlob, so a count of zero proves the cancelled run never rendered one.
    await page.addInitScript(() => {
      window.__jpegEncodes = 0;
      const original = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (cb, type, ...rest) {
        if (type === 'image/jpeg') window.__jpegEncodes++;
        return original.call(this, cb, type, ...rest);
      };
    });
    await page.goto('/compress-pdf');
    await page.evaluate(() => { window.__holdSpec['first.pdf'] = 1; });
    await page.locator('#file-input').setInputFiles({ name: 'first.pdf', mimeType: 'application/pdf', buffer: source });
    const action = page.locator('#action-btn');
    await action.click();
    await page.waitForFunction(() => window.__held('first.pdf'));

    await page.locator('#file-input').setInputFiles({ name: 'second.pdf', mimeType: 'application/pdf', buffer: source });
    await expect(page.locator('.file-item__name')).toHaveText('second.pdf');
    await expect(action).toBeDisabled();

    await page.evaluate(() => window.__release('first.pdf'));
    await expect(action).toBeEnabled();
    expect(await page.evaluate(() => window.__jpegEncodes)).toBe(0);
    await expect(page.locator('#pdf-tool-result')).not.toBeVisible();
  });

  test('a replaced PDF run finishing mid page-load does not enable the button early', async ({ page }) => {
    const source = await readFile(fixture('sample.pdf'));
    await page.addInitScript(holdArrayBuffer);
    // The old run's last step is building its result Blob; noting it tells us the run is over without a timer.
    await page.addInitScript(() => {
      window.__pdfBlobs = 0;
      const Original = window.Blob;
      window.Blob = class extends Original {
        constructor(parts, opts) { super(parts, opts); if (opts?.type === 'application/pdf') window.__pdfBlobs++; }
      };
    });
    await page.goto('/reorder-pdf-pages');
    // first.pdf: call 1 loads thumbnails, call 2 is the run. second.pdf: call 1 is its page load.
    await page.evaluate(() => { window.__holdSpec['first.pdf'] = 2; window.__holdSpec['second.pdf'] = 1; });
    await page.locator('#file-input').setInputFiles({ name: 'first.pdf', mimeType: 'application/pdf', buffer: source });
    const action = page.locator('#action-btn');
    await expect(action).toBeEnabled();
    await action.click();
    await page.waitForFunction(() => window.__held('first.pdf'));
    await page.locator('#file-input').setInputFiles({ name: 'second.pdf', mimeType: 'application/pdf', buffer: source });
    await expect(action).toContainText('Loading pages');
    await page.waitForFunction(() => window.__held('second.pdf'));

    await page.evaluate(() => window.__release('first.pdf'));
    await page.waitForFunction(() => window.__pdfBlobs > 0);
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0))); // let the old run's finally block run
    await expect(action).toBeDisabled();
    await expect(action).toContainText('Loading pages');

    await page.evaluate(() => window.__release('second.pdf'));
    await expect(action).toBeEnabled();
  });

  test('HTML to PDF converts sanitized self-contained HTML', async ({ page }) => {
    await page.goto('/html-to-pdf');
    await page.locator('#file-input').setInputFiles({
      name: 'sample.html',
      mimeType: 'text/html',
      buffer: Buffer.from('<!doctype html><html><head><style>body{font-family:sans-serif}h1{font-size:32px}</style></head><body><h1>IrisFiles HTML test</h1><p>Local content only.</p><script>window.__shouldNotRun=true</script><img src="https://example.com/tracker.png"></body></html>'),
    });

    await page.locator('#action-btn').click();
    await expect(page.locator('#html-pdf-result .btn--success')).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => page.evaluate(() => window.__shouldNotRun === true)).toBe(false);
  });
});
