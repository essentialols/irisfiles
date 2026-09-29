import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { crc32 } from 'node:zlib';

export const FIXTURES = resolve(import.meta.dirname, '..', 'fixtures');

export function fixture(name) {
  return resolve(FIXTURES, name);
}

// A valid two-frame APNG built from sample.png. A stub without IDAT would fail to
// decode instead of being flattened, which would not show the bug.
export async function buildApng() {
  const chunk = (type, data) => {
    const c = Buffer.alloc(12 + data.length);
    c.writeUInt32BE(data.length, 0);
    c.write(type, 4, 'latin1');
    data.copy(c, 8);
    c.writeUInt32BE(crc32(c.subarray(4, 8 + data.length)), 8 + data.length);
    return c;
  };
  const u32 = (...v) => { const b = Buffer.alloc(v.length * 4); v.forEach((x, i) => b.writeUInt32BE(x, i * 4)); return b; };
  const fcTL = seq => Buffer.concat([u32(seq, 100, 100, 0, 0), Buffer.from([0, 1, 0, 10, 0, 0])]);
  const still = await readFile(fixture('sample.png'));
  const idat = [];
  for (let o = 33; o < still.length; o += 12 + still.readUInt32BE(o)) {
    if (still.toString('latin1', o + 4, o + 8) === 'IDAT') idat.push(still.subarray(o + 8, o + 8 + still.readUInt32BE(o)));
  }
  return Buffer.concat([
    still.subarray(0, 33), chunk('acTL', u32(2, 0)), chunk('fcTL', fcTL(0)),
    ...idat.map(d => chunk('IDAT', d)),
    chunk('fcTL', fcTL(1)), ...idat.map((d, i) => chunk('fdAT', Buffer.concat([u32(2 + i), d]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export async function dropFile(page, selector, filePath) {
  const input = page.locator(`${selector} ~ input[type="file"], input[type="file"]`).first();
  await input.setInputFiles(filePath);
}

export async function dropFiles(page, selector, filePaths) {
  const input = page.locator(`${selector} ~ input[type="file"], input[type="file"]`).first();
  await input.setInputFiles(filePaths);
}

export async function waitForDone(page, { timeout = 30_000 } = {}) {
  await page.locator('.file-item.done, .btn-download, .btn--success').first().waitFor({ timeout });
}

export async function waitForStatus(page, text, { timeout = 30_000 } = {}) {
  await page.locator(`.file-item__status:has-text("${text}")`).first().waitFor({ timeout });
}

export async function getFileItemCount(page) {
  // The list renders asynchronously after setInputFiles, so counting straight
  // away reports 0 no matter what was uploaded. Give the list a chance to
  // appear first; genuinely-empty cases still fall through and return 0.
  await page.locator('.file-item').first()
    .waitFor({ state: 'attached', timeout: 2000 })
    .catch(() => {});
  return page.locator('.file-item').count();
}

export async function clickButton(page, text) {
  await page.getByRole('button', { name: text }).click();
}

export async function expectDownloadOnClick(page, buttonSelector) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator(buttonSelector).click(),
  ]);
  return download;
}

// Every test gets a fresh browser context, so every conversion test re-fetched
// the ~25MB FFmpeg.wasm core from jsDelivr. This serves those assets from an
// on-disk cache: the first request populates it, the rest read from the file.
// The real CDN path stays covered by the tests that do not call this.
const CDN_CACHE = resolve(import.meta.dirname, '..', '..', '.patrol', 'cdn-cache');

export async function cacheCdnAssets(page) {
  await mkdir(CDN_CACHE, { recursive: true });
  await page.route('**://cdn.jsdelivr.net/**', async (route) => {
    const url = route.request().url();
    const key = join(CDN_CACHE, createHash('sha1').update(url).digest('hex'));
    try {
      const body = await readFile(key);
      const meta = JSON.parse(await readFile(`${key}.json`, 'utf8'));
      return route.fulfill({ status: 200, headers: meta.headers, body });
    } catch {
      const response = await route.fetch();
      const body = await response.body();
      const headers = response.headers();
      await writeFile(key, body);
      await writeFile(`${key}.json`, JSON.stringify({ headers }));
      return route.fulfill({ status: response.status(), headers, body });
    }
  });
}

/**
 * Assert that handing a page a file it cannot use raises no uncaught error.
 *
 * These tests used to sleep a blind 3s, which was both the slowest thing in
 * their specs and weaker than it looks: elapsed time is not evidence that the
 * page reacted. Waiting for the queued row proves the drop handler actually
 * ran, and networkidle covers any lazy CDN load that could still throw.
 */
export async function expectNoCrashOnBadFile(page, dropTheFile) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await dropTheFile();
  await page.locator('.file-item').first().waitFor({ timeout: 10_000 });
  await page.waitForLoadState('networkidle');
  return errors;
}
