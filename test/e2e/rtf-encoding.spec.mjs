import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';


test.describe('RTF text encoding', () => {
  test('Windows-1252 hex escapes download as the intended Unicode text', async ({ page }) => {
    await page.goto('/rtf-to-txt');
    await page.locator('#file-input').setInputFiles(fixture('windows-1252.rtf'));
    await page.locator('#action-btn').click();
    await expect(page.locator('#doc-results')).toBeVisible({ timeout: 30000 });

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#dl-doc').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('windows-1252.txt');

    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');

    expect(text).toBe('Café costs € 5.\n“Quoted” — done.\nUnicode snowman: ☃');
    expect(text).not.toMatch(/[\u0080-\u009F]/);
  });

  for (const [codePage, bytes, expected] of [
    [1250, [90,97,191,243,179,230,32,103,234,156,108,185,32,106,97,159,241], 'Zażółć gęślą jaźń'],
    [1251, [207,240,232,226,229,242,44,32,236,232,240], 'Привет, мир'],
  ]) {
    test(`Windows-${codePage} hex escapes use the declared code page`, async ({ page }) => {
      const slash = String.fromCharCode(92);
      const body = bytes.map(byte => slash + "'" + byte.toString(16).padStart(2, '0')).join('');
      const rtf = '{' + slash + 'rtf1' + slash + 'ansi' + slash + 'ansicpg' + codePage + ' ' + body + '}';
      await page.goto('/rtf-to-txt');
      await page.locator('#file-input').setInputFiles({
        name: `windows-${codePage}.rtf`,
        mimeType: 'application/rtf',
        buffer: Buffer.from(rtf, 'utf8'),
      });
      await page.locator('#action-btn').click();
      await expect(page.locator('#doc-results')).toBeVisible({ timeout: 30000 });
      const downloadPromise = page.waitForEvent('download');
      await page.locator('#dl-doc').click();
      const stream = await (await downloadPromise).createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      expect(Buffer.concat(chunks).toString('utf8')).toBe(expected);
    });
  }

  async function convertedText(page, fixtureName) {
    await page.goto('/rtf-to-txt');
    await page.locator('#file-input').setInputFiles(fixture(fixtureName));
    await page.locator('#action-btn').click();
    await expect(page.locator('#doc-results')).toBeVisible({ timeout: 30000 });
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#dl-doc').click();
    const stream = await (await downloadPromise).createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8').trim();
  }

  // The space that terminates \uN is a delimiter, not one of the ANSI fallback
  // characters \uc says to skip, so it must not consume the '?'.
  test('a space delimiting a Unicode control word is not counted as a fallback', async ({ page }) => {
    expect(await convertedText(page, 'unicode-delimiter.rtf')).toBe('\u00E9clair and \u00E9clair');
  });

  // An escaped brace inside a skipped group used to end the group early and leak
  // the rest of its contents into the output.
  test('an escaped brace inside a skipped group does not leak the group body', async ({ page }) => {
    const text = await convertedText(page, 'escaped-brace-group.rtf');
    expect(text).toBe('Hello');
    expect(text).not.toContain('def');
  });
});
