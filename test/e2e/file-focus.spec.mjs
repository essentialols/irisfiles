import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

const supportedExtensions = [
  'heic','heif','jpg','jpeg','png','webp','gif','bmp','avif','tif','tiff','ico','svg',
  'pdf','mp4','webm','mov','avi','mkv','mp3','wav','ogg','flac','m4a','aac',
  'epub','rtf','docx','mobi','prc','ttf','otf','woff','zip',
];

const familyCases = [
  { page: '/heic-to-jpg', file: 'sample.heic', action: '/heic-to-png' },
  { page: '/avif-to-jpg', file: 'sample.avif', action: '/avif-to-png' },
  { page: '/tiff-to-jpg', file: 'sample.tiff', action: '/tiff-to-png' },
  { page: '/ico-to-png', file: 'sample.ico', action: '/ico-to-jpg' },
  { page: '/svg-to-png', file: 'sample.svg', action: '/svg-to-jpg' },
  { page: '/pdf-to-jpg', file: 'sample.pdf', action: '/compress-pdf' },
  { page: '/mp4-to-webm', file: 'sample.mp4', action: '/mp4-to-mp3' },
  { page: '/mp3-to-wav', file: 'sample.mp3', action: '/compress-audio' },
  { page: '/docx-to-txt', file: 'sample.docx', action: '/docx-to-pdf' },
  { page: '/ttf-to-otf', file: 'sample.ttf', action: '/ttf-to-woff' },
  { page: '/extract-zip', file: 'sample.zip', action: '/extract-zip' },
];

test.describe('Persistent current-file workspace', () => {
  test('route map covers every supported source extension', async ({ page }) => {
    await page.goto('/');
    const keys = await page.evaluate(async () => {
      const { ACTIONS_BY_EXT } = await import('/js/file-focus.js');
      return Object.keys(ACTIONS_BY_EXT);
    });
    for (const ext of supportedExtensions) {
      expect(keys, `missing active-file actions for .${ext}`).toContain(ext);
    }
  });

  for (const { page: route, file, action } of familyCases) {
    test(`workspace appears on ${route} and exposes a next action`, async ({ page }) => {
      await page.goto(route);
      await page.locator('#file-input').setInputFiles(fixture(file));

      const workspace = page.locator('#active-file-focus');
      await expect(workspace).toBeVisible();
      await expect(workspace.locator('.file-focus__name')).toHaveText(file);
      await expect(workspace.locator(`a[href="${action}"]`)).toBeVisible();
      await expect(workspace.getByRole('button', { name: 'Choose another' })).toBeVisible();
    });
  }

  test('specialized image tools use the same workspace', async ({ page }) => {
    for (const route of ['/background-remover', '/image-to-text', '/png-to-ico']) {
      await page.goto(route);
      await page.locator('#file-input').setInputFiles(fixture('sample.png'));
      await expect(page.locator('#active-file-focus')).toBeVisible();
      await expect(page.locator('#active-file-focus .file-focus__name')).toHaveText('sample.png');
    }
  });

  test('advanced PDF tools use the same workspace', async ({ page }) => {
    for (const route of ['/compress-pdf', '/rotate-pdf', '/reorder-pdf-pages', '/delete-pdf-pages', '/extract-pdf-pages']) {
      await page.goto(route);
      await page.locator('#file-input').setInputFiles(fixture('sample.pdf'));
      await expect(page.locator('#active-file-focus')).toBeVisible();
      await expect(page.locator('#active-file-focus a[href="/pdf-to-jpg"]')).toBeVisible();
    }
  });

  test('video to audio extraction uses the same workspace', async ({ page }) => {
    await page.goto('/mp4-to-mp3');
    await page.locator('#file-input').setInputFiles(fixture('sample.mp4'));
    await expect(page.locator('#active-file-focus')).toBeVisible();
    await expect(page.locator('#active-file-focus a[href="/mp4-to-wav"]')).toBeVisible();
  });

  test('switching conversion keeps and rehydrates the original file', async ({ page }) => {
    await page.goto('/png-to-jpg');
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));
    await expect(page.locator('#active-file-focus .file-focus__name')).toHaveText('sample.png');

    await page.locator('#active-file-focus a[href="/png-to-webp"]').click();
    await expect(page).toHaveURL(/\/png-to-webp$/);
    await expect(page.locator('#active-file-focus .file-focus__name')).toHaveText('sample.png');
    await expect.poll(async () => page.locator('#file-input').evaluate(el => el.files?.[0]?.name || ''))
      .toBe('sample.png');
  });

  test('the original source stays active after a conversion completes', async ({ page }) => {
    await page.goto('/png-to-jpg');
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));
    await expect(page.locator('.file-item.done')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#active-file-focus .file-focus__name')).toHaveText('sample.png');
    await expect(page.locator('#active-file-focus a[href="/png-to-webp"]')).toBeVisible();
  });

  test('selecting a new file replaces the current file', async ({ page }) => {
    await page.goto('/png-to-jpg');
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));
    await expect(page.locator('#active-file-focus .file-focus__name')).toHaveText('sample.png');

    await page.locator('#file-input').setInputFiles(fixture('sample2.png'));
    await expect(page.locator('#active-file-focus .file-focus__name')).toHaveText('sample2.png');
  });

  test('current file remains visible when returning to the landing page', async ({ page }) => {
    await page.goto('/png-to-jpg');
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));
    await expect(page.locator('#active-file-focus .file-focus__name')).toHaveText('sample.png');

    await page.goto('/');
    await expect(page.locator('#active-file-focus')).toBeVisible();
    await expect(page.locator('#active-file-focus .file-focus__name')).toHaveText('sample.png');
    await expect(page.locator('#active-file-focus a[href="/png-to-webp"]')).toBeVisible();
  });

  test('workspace separates conversions from tools and highlights the current route', async ({ page }) => {
    await page.goto('/png-to-jpg');
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));

    const workspace = page.locator('#active-file-focus');
    await expect(workspace.locator('.file-focus__group-label')).toHaveText(['Convert to', 'Tools']);
    await expect(workspace.locator('a[href="/png-to-jpg"]')).toHaveClass(/is-current/);
    await expect(workspace.locator('a[href="/background-remover"]')).toBeVisible();
    await expect(workspace.locator('a[href="/image-to-text"]')).toBeVisible();
    await expect(workspace.locator('a[href="/png-to-ico"]')).toBeVisible();
    await expect(workspace.locator('a[href="/create-zip"]')).toBeVisible();
  });

  test('even an otherwise unsupported file can stay active in Create ZIP', async ({ page }) => {
    await page.goto('/create-zip');
    await page.locator('#file-input').setInputFiles(fixture('sample.txt'));

    const workspace = page.locator('#active-file-focus');
    await expect(workspace).toBeVisible();
    await expect(workspace.locator('.file-focus__name')).toHaveText('sample.txt');
    await expect(workspace.locator('a[href="/create-zip"]')).toHaveClass(/is-current/);
  });

  test('mobile actions stay compact and horizontally scrollable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/mp4-to-webm');
    await page.locator('#file-input').setInputFiles(fixture('sample.mp4'));

    const actions = page.locator('#active-file-focus .file-focus__actions').first();
    await expect(actions).toBeVisible();
    expect(await actions.evaluate(el => getComputedStyle(el).overflowX)).toBe('auto');
    await expect(page.locator('#active-file-focus .file-focus__name')).toHaveText('sample.mp4');
  });
});
