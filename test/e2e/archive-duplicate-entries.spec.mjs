import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.data);
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

test.describe('Extract ZIP duplicate paths', () => {
  test('preserves every duplicate member with a unique download name', async ({ page }) => {
    const zip = makeStoredZip([
      { name: 'report.txt', data: Buffer.from('FIRST REPORT\n') },
      { name: 'nested/日本語.txt', data: Buffer.from('秘密のメモ\n') },
      { name: 'empty.bin', data: Buffer.alloc(0) },
      { name: 'report.txt', data: Buffer.from('SECOND REPORT\n') },
    ]);

    await page.goto('/extract-zip');
    await page.locator('#file-input').setInputFiles({
      name: 'duplicate-paths.zip',
      mimeType: 'application/zip',
      buffer: zip,
    });
    await page.locator('#action-btn').click();
    await page.locator('#archive-results').waitFor({ timeout: 10000 });

    await expect(page.locator('#archive-results .file-item__name')).toHaveText([
      'report.txt',
      'nested/日本語.txt',
      'empty.bin',
      'report (2).txt',
    ]);
    await expect(page.locator('.batch-summary')).toContainText('4 files extracted');

    const expected = new Map([
      ['report.txt', 'FIRST REPORT\n'],
      ['report (2).txt', 'SECOND REPORT\n'],
    ]);
    for (const [name, text] of expected) {
      const row = page.locator('#archive-results .file-item').filter({ hasText: name });
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        row.locator('.dl-btn').click(),
      ]);
      expect(download.suggestedFilename()).toBe(name);
      expect(await readFile(await download.path(), 'utf8')).toBe(text);
    }

    const [batchDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#dl-all').click(),
    ]);
    const batchBytes = await readFile(await batchDownload.path());
    const unpacked = await page.evaluate(bytes => {
      const entries = fflate.unzipSync(Uint8Array.from(bytes));
      return Object.fromEntries(Object.entries(entries).map(([name, data]) => [
        name,
        new TextDecoder().decode(data),
      ]));
    }, Array.from(batchBytes));

    expect(unpacked['report.txt']).toBe('FIRST REPORT\n');
    expect(unpacked['report (2).txt']).toBe('SECOND REPORT\n');
    expect(unpacked['nested/日本語.txt']).toBe('秘密のメモ\n');
    expect(Object.prototype.hasOwnProperty.call(unpacked, 'empty.bin')).toBe(true);
  });

  // The sanitizer's own edge cases live in test/archive-name.mjs, which costs a
  // function call instead of a browser round trip. What only the browser can
  // prove is the wiring: the extract page renders the sanitized names, counts
  // only the genuinely unsafe ones, and re-zips from the sanitized names.
  test('renders sanitized member names and rezips them', async ({ page }) => {
    const zip = makeStoredZip([
      { name: 'docs/readme.txt', data: Buffer.from('SAFE DOC\n') },
      { name: '/C:/drive.txt', data: Buffer.from('DRIVE\n') },
      { name: '../escape.txt', data: Buffer.from('ESCAPE\n') },
      { name: 'nested/./keep.txt', data: Buffer.from('KEEP\n') },
    ]);

    await page.goto('/extract-zip');
    await page.locator('#file-input').setInputFiles({
      name: 'unsafe-paths.zip',
      mimeType: 'application/zip',
      buffer: zip,
    });
    await page.locator('#action-btn').click();
    await page.locator('#archive-results').waitFor({ timeout: 10000 });

    // "nested/./keep.txt" is a cosmetic rewrite and must not inflate the count.
    await expect(page.locator('#archive-results .notice')).toContainText(
      '2 unsafe archive paths normalized to safe relative names.'
    );
    await expect(page.locator('#archive-results .file-item__name')).toHaveText([
      'docs/readme.txt',
      'drive.txt',
      'escape.txt',
      'nested/keep.txt',
    ]);

    const [batchDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#dl-all').click(),
    ]);
    const batchBytes = await readFile(await batchDownload.path());
    const unpacked = await page.evaluate(bytes => {
      const entries = fflate.unzipSync(Uint8Array.from(bytes));
      return Object.fromEntries(Object.entries(entries).map(([name, data]) => [
        name,
        new TextDecoder().decode(data),
      ]));
    }, Array.from(batchBytes));

    expect(Object.keys(unpacked).sort()).toEqual([
      'docs/readme.txt',
      'drive.txt',
      'escape.txt',
      'nested/keep.txt',
    ]);
    expect(unpacked['drive.txt']).toBe('DRIVE\n');
    expect(unpacked['escape.txt']).toBe('ESCAPE\n');
  });
});
