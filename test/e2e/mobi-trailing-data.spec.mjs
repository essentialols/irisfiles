import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

function backwardVwi(value) {
  if (!Number.isInteger(value) || value < 1) throw new Error('invalid fixture VWI');
  const bytes = [value & 0x7f];
  for (let n = Math.floor(value / 128); n > 0; n = Math.floor(n / 128)) {
    bytes.unshift(n & 0x7f);
  }
  bytes[0] |= 0x80;
  return Buffer.from(bytes);
}

function trailingEntry(data) {
  const payload = Buffer.from(data, 'ascii');
  return Buffer.concat([payload, backwardVwi(payload.length + 1)]);
}

function palmDocLiteralEncode(data) {
  const out = [];
  for (let offset = 0; offset < data.length; offset += 8) {
    const chunk = data.subarray(offset, Math.min(offset + 8, data.length));
    out.push(Buffer.from([chunk.length]), chunk);
  }
  return Buffer.concat(out);
}

function mobiWithTrailingData({ compression = 1, malformedTrailing = false } = {}) {
  const textRecords = [
    Buffer.from('FIRST CHAPTER\n', 'utf8'),
    Buffer.from('SECOND CHAPTER — résumé 日本語\n', 'utf8'),
  ];
  const expected = Buffer.concat(textRecords).toString('utf8').trim();
  const records = textRecords.map((text, index) => {
    const body = compression === 2 ? palmDocLiteralEncode(text) : text;
    if (malformedTrailing && index === textRecords.length - 1) {
      // Flag 0x0002 says a backwards-VWI-sized entry is present, but 0xff
      // claims 127 bytes although this record is much smaller.
      return Buffer.concat([body, Buffer.from([0xff])]);
    }
    return Buffer.concat([body, trailingEntry(`INDEX-${index + 1}`)]);
  });

  const numRecords = 1 + records.length;
  const pdb = Buffer.alloc(78 + numRecords * 8 + 2);
  Buffer.from('IrisFiles trailing fixture').copy(pdb, 0);
  Buffer.from('BOOK').copy(pdb, 60);
  Buffer.from('MOBI').copy(pdb, 64);
  pdb.writeUInt16BE(numRecords, 76);

  const record0 = Buffer.alloc(16 + 232);
  record0.writeUInt16BE(compression, 0);
  record0.writeUInt32BE(Buffer.concat(textRecords).length, 4);
  record0.writeUInt16BE(records.length, 8);
  record0.writeUInt16BE(4096, 10);
  record0.writeUInt16BE(0, 12);
  Buffer.from('MOBI').copy(record0, 16);
  record0.writeUInt32BE(232, 20);
  record0.writeUInt32BE(2, 24);
  record0.writeUInt32BE(65001, 28);
  record0.writeUInt32BE(1, 32);
  record0.writeUInt32BE(6, 36);
  record0.writeUInt32BE(6, 104);
  record0.writeUInt16BE(0x0002, 242);

  let offset = pdb.length;
  const allRecords = [record0, ...records];
  for (let index = 0; index < allRecords.length; index++) {
    pdb.writeUInt32BE(offset, 78 + index * 8);
    offset += allRecords[index].length;
  }

  return {
    buffer: Buffer.concat([pdb, ...allRecords]),
    expected,
  };
}

async function convertAndRead(page, fixture, name) {
  await page.goto('/mobi-to-txt');
  await page.locator('#file-input').setInputFiles({
    name,
    mimeType: 'application/x-mobipocket-ebook',
    buffer: fixture.buffer,
  });

  await page.locator('#action-btn').click();
  const downloadButton = page.locator('#dl-doc');
  await expect(downloadButton).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await downloadButton.click();
  const download = await downloadPromise;
  return readFile(await download.path(), 'utf8');
}

for (const compression of [1, 2]) {
  test(`MOBI to TXT strips trailing record data before decoding compression ${compression}`, async ({ page }) => {
    const fixture = mobiWithTrailingData({ compression });
    const output = await convertAndRead(page, fixture, `trailing-${compression}.mobi`);

    expect(output).toBe(fixture.expected);
    expect(output).not.toContain('INDEX-');
    expect(output).toContain('résumé 日本語');
  });
}

test('MOBI to TXT rejects malformed declared trailing record data', async ({ page }) => {
  const fixture = mobiWithTrailingData({ malformedTrailing: true });
  await page.goto('/mobi-to-txt');
  await page.locator('#file-input').setInputFiles({
    name: 'malformed-trailing.mobi',
    mimeType: 'application/x-mobipocket-ebook',
    buffer: fixture.buffer,
  });
  await page.locator('#action-btn').click();

  const error = page.locator('#doc-results .notice[data-kind="error"]');
  await expect(error).toHaveText('Invalid MOBI file: malformed trailing record data.');
  await expect(page.locator('#dl-doc')).toHaveCount(0);
});
