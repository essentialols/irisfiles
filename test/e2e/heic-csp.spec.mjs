import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

// Production's CSP has no 'unsafe-eval'; fail on any CSP violation during HEIC conversion.
const SIGNATURES = {
  '/heic-to-jpg': [0xff, 0xd8, 0xff],
  '/heic-to-png': [0x89, 0x50, 0x4e, 0x47],
  '/heic-to-webp': [0x52, 0x49, 0x46, 0x46],
  '/heic-to-pdf': [0x25, 0x50, 0x44, 0x46],
};

// Worker violations surface only as console errors, document ones also as events.
async function watchCsp(page) {
  const seen = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) seen.push(`console: ${msg.text()}`);
  });
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations.push(`${event.violatedDirective} blocked ${event.blockedURI}`);
    });
  });
  return async () => seen.concat(await page.evaluate(() => window.__cspViolations || []));
}

async function convertHeic(page, path) {
  await page.goto(path);
  await page.locator('#file-input').setInputFiles(fixture('sample.heic'));
  if (path === '/heic-to-pdf') await page.locator('#action-btn').click();
  await page.locator('.file-item.done').first().waitFor({ timeout: 40_000 });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#dl-single, .btn-download').first().click(),
  ]);
  return readFile(await download.path());
}

for (const [path, signature] of Object.entries(SIGNATURES)) {
  test.describe(`HEIC decoding under the production CSP on ${path}`, () => {
    test('converts sample.heic with no CSP violation', async ({ page }) => {
      const cspViolations = await watchCsp(page);
      const bytes = await convertHeic(page, path);
      expect(await cspViolations()).toEqual([]);
      expect([...bytes.subarray(0, signature.length)]).toEqual(signature);
    });
  });
}

test.describe('HEIC decoder local fallback under the production CSP', () => {
  test('converts with the CDN unreachable', async ({ page }) => {
    const cspViolations = await watchCsp(page);
    await page.route('**://cdn.jsdelivr.net/**', (route) => route.abort());
    const bytes = await convertHeic(page, '/heic-to-jpg');
    expect(await cspViolations()).toEqual([]);
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });
});
