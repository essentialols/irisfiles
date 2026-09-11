import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function storedZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, value] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

async function downloadText(page) {
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#dl-doc').click();
  const download = await downloadPromise;
  return readFile(await download.path(), 'utf8');
}

test('EPUB resolves spine href dot segments and ignores fragments', async ({ page }) => {
  const containerXml = `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OPS/package/content.opf"/></rootfiles>
</container>`;
  const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf">
  <manifest><item id="chapter" href="../../Text/./chapter.xhtml#start" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`;
  const chapter = '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Resolved chapter</p></body></html>';

  await page.goto('/epub-to-txt');
  await page.locator('#file-input').setInputFiles({
    name: 'relative-spine.epub',
    mimeType: 'application/epub+zip',
    buffer: storedZip({
      'META-INF/container.xml': containerXml,
      'OPS/package/content.opf': opf,
      'Text/chapter.xhtml': chapter,
    }),
  });
  await page.locator('#action-btn').click();
  await expect(page.locator('#dl-doc')).toBeVisible({ timeout: 30000 });

  expect(await downloadText(page)).toBe('Resolved chapter');
});

test('RTF honors group-scoped uc values and escaped fallback characters', async ({ page }) => {
  const rtf = '{\\rtf1\\ansi\\uc0 Unicode: \\u945X {\\uc2\\u946\\\'62?Y} \\u947Z; accent: {\\uc1\\u233\\\'e9}.}';

  await page.goto('/rtf-to-txt');
  await page.locator('#file-input').setInputFiles({
    name: 'unicode-fallbacks.rtf',
    mimeType: 'application/rtf',
    buffer: Buffer.from(rtf),
  });
  await page.locator('#action-btn').click();
  await expect(page.locator('#dl-doc')).toBeVisible({ timeout: 30000 });

  expect(await downloadText(page)).toBe('Unicode: αX βY γZ; accent: é.');
});

test('replacing a file during conversion discards the stale result', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error));
  await page.goto('/rtf-to-txt');
  await page.evaluate(() => {
    const original = Blob.prototype.text;
    Blob.prototype.text = async function () {
      if (this instanceof File && this.name === 'first.rtf') {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      return original.call(this);
    };
  });

  await page.locator('#file-input').setInputFiles({
    name: 'first.rtf',
    mimeType: 'application/rtf',
    buffer: Buffer.from(String.raw`{\rtf1 First}`),
  });
  await page.locator('#action-btn').click();
  await page.locator('#file-input').setInputFiles({
    name: 'second.rtf',
    mimeType: 'application/rtf',
    buffer: Buffer.from(String.raw`{\rtf1 Second}`),
  });

  await expect(page.locator('.file-item__name')).toContainText('second.rtf');
  await page.waitForTimeout(700);
  await expect(page.locator('#doc-results')).toHaveCount(0);
  await expect(page.locator('#action-btn')).toBeEnabled();
  expect(pageErrors).toEqual([]);
});
