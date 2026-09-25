import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';


test.describe('Font Pages', () => {
  const fontPages = [
    { path: '/otf-to-ttf', target: 'ttf' },
    { path: '/woff-to-ttf', target: 'ttf' },
    { path: '/ttf-to-otf', target: 'otf' },
    { path: '/woff-to-otf', target: 'otf' },
    { path: '/ttf-to-woff', target: 'woff' },
    { path: '/otf-to-woff', target: 'woff' },
  ];

  fontPages.forEach(({ path, target }) => {
    test.describe(path, () => {


      test('action button hidden initially', async ({ page }) => {
        await page.goto(`${path}`);
        const actionBtn = page.locator('#action-btn');
        await expect(actionBtn).not.toBeVisible();
      });

      test('clear all hidden initially', async ({ page }) => {
        await page.goto(`${path}`);
        const clearAll = page.locator('#clear-all');
        await expect(clearAll).not.toBeVisible();
      });

    });
  });
});

test.describe('Document Pages - General', () => {
  const docPages = [
    { path: '/epub-to-txt', mode: 'epub-to-txt' },
    { path: '/epub-to-pdf', mode: 'epub-to-pdf' },
    { path: '/rtf-to-txt', mode: 'rtf-to-txt' },
    { path: '/rtf-to-pdf', mode: 'rtf-to-pdf' },
    { path: '/docx-to-txt', mode: 'docx-to-txt' },
    { path: '/docx-to-pdf', mode: 'docx-to-pdf' },
    { path: '/mobi-to-txt', mode: 'mobi-to-txt' },
    { path: '/mobi-to-pdf', mode: 'mobi-to-pdf' },
  ];

  docPages.forEach(({ path, mode }) => {
    test.describe(path, () => {


      test('action button hidden initially', async ({ page }) => {
        await page.goto(`${path}`);
        const actionBtn = page.locator('#action-btn');
        await expect(actionBtn).not.toBeVisible();
      });

      test('clear all hidden initially', async ({ page }) => {
        await page.goto(`${path}`);
        const clearAll = page.locator('#clear-all');
        await expect(clearAll).not.toBeVisible();
      });
    });
  });
});

test.describe('Document Pages - EPUB Conversion', () => {
  test('EPUB to TXT preserves readable block boundaries and Unicode', async ({ page }) => {
    await page.goto('/epub-to-txt');
    await page.locator('#file-input').setInputFiles(fixture('sample.epub'));
    await page.locator('#action-btn').click();
    await expect(page.locator('#doc-results')).toBeVisible({ timeout: 30000 });

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#dl-doc').click();
    const download = await downloadPromise;
    const outputPath = await download.path();
    expect(outputPath).toBeTruthy();

    const text = await readFile(outputPath, 'utf8');
    expect(text).toBe(
      'Chapter One\nIrisFiles fixture. Unicode: café 日本語 Ω.\n\n' +
      'Chapter Two\nSecond chapter with more text to paginate.'
    );
  });
});

test.describe('Document Pages - RTF Conversion', () => {
  const rtfPages = [
    { path: '/rtf-to-txt' },
    { path: '/rtf-to-pdf' },
  ];

  rtfPages.forEach(({ path }) => {
    test.describe(path, () => {
      test('upload RTF shows file item', async ({ page }) => {
        await page.goto(`${path}`);
        await page.locator('#file-input').setInputFiles(fixture('sample.rtf'));
        const fileList = page.locator('#file-list');
        await expect(fileList).toBeVisible();
        const fileItem = fileList.locator('.file-item').first();
        await expect(fileItem).toBeVisible();
      });

      test('action button appears after upload', async ({ page }) => {
        await page.goto(`${path}`);
        await page.locator('#file-input').setInputFiles(fixture('sample.rtf'));
        const actionBtn = page.locator('#action-btn');
        await expect(actionBtn).toBeVisible();
      });

      test('convert produces result', async ({ page }) => {
        await page.goto(`${path}`);
        await page.locator('#file-input').setInputFiles(fixture('sample.rtf'));
        await page.locator('#action-btn').click();
        const results = page.locator('#doc-results');
        await expect(results).toBeVisible({ timeout: 30000 });
      });

      test('download button exists in results', async ({ page }) => {
        await page.goto(`${path}`);
        await page.locator('#file-input').setInputFiles(fixture('sample.rtf'));
        await page.locator('#action-btn').click();
        await expect(page.locator('#doc-results')).toBeVisible({ timeout: 30000 });
        const dlBtn = page.locator('#dl-doc');
        await expect(dlBtn).toBeVisible();
      });

      test('clear all resets', async ({ page }) => {
        await page.goto(`${path}`);
        await page.locator('#file-input').setInputFiles(fixture('sample.rtf'));
        await expect(page.locator('#file-list')).toBeAttached();
        await page.locator('#clear-all').click();
        // #file-list is a static container: clearing empties it rather
        // than removing it.
        await expect(page.locator('#file-list .file-item')).toHaveCount(0);
      });
    });
  });
});

test.describe('Document Pages - DOCX Visible Text', () => {
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
      local.writeUInt16LE(0x0800, 6); // UTF-8 filenames
      local.writeUInt16LE(0, 8);      // stored, no compression
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

  function nestedVisibleTextDocx() {
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p>
      <w:r><w:t xml:space="preserve">Before </w:t></w:r>
      <w:ins w:id="1" w:author="IrisFiles"><w:r><w:t>inserted ✓</w:t></w:r></w:ins>
      <w:r><w:t xml:space="preserve"> after</w:t></w:r>
    </w:p>
    <w:p><w:r><w:t>Line one</w:t><w:br/><w:t>Line two</w:t></w:r></w:p>
    <w:p><w:r><w:t>Label</w:t><w:tab/><w:t>Value</w:t></w:r></w:p>
    <w:p><w:hyperlink r:id="rId2"><w:r><w:t>Docs</w:t><w:br/><w:t>Next</w:t></w:r></w:hyperlink></w:p>
    <w:p>
      <w:r><w:t xml:space="preserve">Visible: </w:t></w:r>
      <w:sdt><w:sdtContent><w:r><w:t>controlled</w:t></w:r></w:sdtContent></w:sdt>
    </w:p>
    <w:p>
      <w:r><w:t>Keep</w:t></w:r>
      <w:del w:id="2" w:author="IrisFiles"><w:r><w:delText xml:space="preserve"> old</w:delText></w:r></w:del>
      <w:r><w:t xml:space="preserve"> new</w:t></w:r>
    </w:p>
    <w:sectPr/>
  </w:body>
</w:document>`;
    const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/" TargetMode="External"/>
</Relationships>`;

    return storedZip({
      '[Content_Types].xml': contentTypes,
      '_rels/.rels': rels,
      'word/document.xml': documentXml,
      'word/_rels/document.xml.rels': documentRels,
    });
  }

  function numberedListDocx() {
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
    const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="10">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1.%2)"/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="11">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#xF0B7;"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="11"/></w:num>
</w:numbering>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="ListNumberStyle">
    <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>
  </w:style>
</w:styles>`;
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
  <w:p><w:r><w:t>Project checklist</w:t></w:r></w:p>
  <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Prepare résumé 日本語</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="ListNumberStyle"/></w:pPr><w:r><w:t>Confirm café details</w:t></w:r></w:p>
  <w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Send link</w:t></w:r></w:p>
  <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>Keep a backup</w:t></w:r></w:p>
  <w:sectPr/>
</w:body></w:document>`;

    return storedZip({
      '[Content_Types].xml': contentTypes,
      '_rels/.rels': rels,
      'word/document.xml': documentXml,
      'word/numbering.xml': numbering,
      'word/styles.xml': styles,
    });
  }

  function tableDocx() {
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
  <w:p><w:r><w:t>Quarterly contacts</w:t></w:r></w:p>
  <w:tbl>
    <w:tr>
      <w:tc><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>Phone</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>Notes</w:t></w:r></w:p></w:tc>
    </w:tr>
    <w:tr>
      <w:tc><w:p><w:r><w:t>Zoë 日本語</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>+1 415 555 0100</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>Café résumé</w:t></w:r></w:p></w:tc>
    </w:tr>
    <w:tr>
      <w:tc><w:p><w:r><w:t>Berlin</w:t></w:r></w:p></w:tc>
      <w:tc><w:p/></w:tc>
      <w:tc><w:p><w:r><w:t>No phone listed</w:t></w:r></w:p></w:tc>
    </w:tr>
    <w:tr>
      <w:tc>
        <w:p><w:r><w:t>Munich</w:t></w:r></w:p>
        <w:p><w:r><w:t>Bavaria</w:t></w:r></w:p>
      </w:tc>
      <w:sdt>
        <w:sdtPr><w:alias w:val="Phone"/></w:sdtPr>
        <w:sdtContent><w:tc><w:p><w:r><w:t>+49 30 555 0100</w:t></w:r></w:p></w:tc></w:sdtContent>
      </w:sdt>
      <w:tc><w:p><w:r><w:t>Second office</w:t></w:r></w:p></w:tc>
    </w:tr>
  </w:tbl>
  <w:p><w:r><w:t>End notes</w:t></w:r></w:p>
  <w:sectPr/>
</w:body></w:document>`;

    return storedZip({
      '[Content_Types].xml': contentTypes,
      '_rels/.rels': rels,
      'word/document.xml': documentXml,
    });
  }

  // No w:* namespace anywhere, so extractDocxText takes its querySelectorAll
  // fallback. That is the only path on which the namespace-only nested-table
  // probe can be wrong, and it is where flattening an outer row would drop the
  // inner table's neighbours out of document order.
  function nestedTableUnnamespacedDocx() {
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<document><body>
  <p><r><t>Outer intro</t></r></p>
  <tbl>
    <tr>
      <tc><p><r><t>Outer cell</t></r></p></tc>
      <tc>
        <p><r><t>Before inner</t></r></p>
        <tbl>
          <tr>
            <tc><p><r><t>Inner A</t></r></p></tc>
            <tc><p><r><t>Inner B</t></r></p></tc>
          </tr>
        </tbl>
        <p><r><t>After inner</t></r></p>
      </tc>
    </tr>
  </tbl>
  <p><r><t>Outer end</t></r></p>
</body></document>`;

    return storedZip({
      '[Content_Types].xml': contentTypes,
      '_rels/.rels': rels,
      'word/document.xml': documentXml,
    });
  }

  test('keeps table cells on tab-separated rows in visible text', async ({ page }) => {
    await page.goto('/docx-to-txt');
    await page.locator('#file-input').setInputFiles({
      name: 'contacts-日本語.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: tableDocx(),
    });

    await page.locator('#action-btn').click();
    await expect(page.locator('#dl-doc')).toBeVisible({ timeout: 30000 });

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#dl-doc').click();
    const download = await downloadPromise;
    const text = await readFile(await download.path(), 'utf8');

    expect(text).toBe([
      'Quarterly contacts',
      'Name\tPhone\tNotes',
      'Zoë 日本語\t+1 415 555 0100\tCafé résumé',
      'Berlin\t\tNo phone listed',
      // A cell wrapped in a content control still holds its column, and a
      // two-paragraph cell continues onto the next row.
      'Munich\t+49 30 555 0100\tSecond office',
      'Bavaria\t\t',
      'End notes',
    ].join('\n'));
  });

  test('falls back to paragraph order for a nested table without namespaces', async ({ page }) => {
    await page.goto('/docx-to-txt');
    await page.locator('#file-input').setInputFiles({
      name: 'nested.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: nestedTableUnnamespacedDocx(),
    });

    await page.locator('#action-btn').click();
    await expect(page.locator('#dl-doc')).toBeVisible({ timeout: 30000 });

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#dl-doc').click();
    const download = await downloadPromise;
    const text = await readFile(await download.path(), 'utf8');

    // The outer row holds a grid, so its own paragraphs stay one per line in
    // document order. The inner row is reached on its own and still renders as
    // columns. Flattening the outer row would reorder "After inner".
    expect(text).toBe([
      'Outer intro',
      'Outer cell',
      'Before inner',
      'Inner A\tInner B',
      'After inner',
      'Outer end',
    ].join('\n'));
  });

  test('DOCX to PDF separates table columns with spaces jsPDF can render', async ({ page }) => {
    await page.goto('/docx-to-pdf');
    await page.locator('#file-input').setInputFiles({
      name: 'contacts.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: tableDocx(),
    });

    await page.locator('#action-btn').click();
    await expect(page.locator('#dl-doc')).toBeVisible({ timeout: 30000 });

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#dl-doc').click();
    const download = await downloadPromise;
    const pdf = await readFile(await download.path());

    // Render the PDF rather than assume a tab would have worked. jsPDF passes a
    // tab through unexpanded and helvetica has no advance for it, so the text
    // layer still reads as separate words while the page draws "NamePhoneNotes".
    // Positions are the only evidence of what a reader sees, so measure them.
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: false }).promise;
    const items = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const content = await (await doc.getPage(pageNumber)).getTextContent();
      for (const item of content.items) {
        if (item.str) items.push({ str: item.str, x: item.transform[4], width: item.width });
      }
    }
    await doc.destroy();

    const gapBefore = label => {
      const index = items.findIndex(item => item.str === label);
      expect(index, `no drawn text "${label}" in the PDF`).toBeGreaterThan(0);
      let previous = index - 1;
      while (previous >= 0 && !items[previous].str.trim()) previous--;
      expect(previous, `nothing drawn before "${label}"`).toBeGreaterThanOrEqual(0);
      return items[index].x - (items[previous].x + items[previous].width);
    };

    const rendered = items.map(item => item.str).join('');
    expect(rendered).toContain('Name Phone Notes');
    // The content-control cell has to reach the PDF too: docxToPdf shares the
    // extractor, so text lost there is lost on both pages.
    expect(rendered).toContain('+49 30 555 0100');

    // Each gap is four space advances, ~3.34pt each at this size.
    expect(gapBefore('Phone')).toBeGreaterThan(8);
    expect(gapBefore('Notes')).toBeGreaterThan(8);
    expect(gapBefore('Second office')).toBeGreaterThan(8);

    // And the separation must not rest on a tab. jsPDF writes one through
    // unexpanded, and the standard Helvetica this page references has no glyph
    // for code 9, so its advance is whatever a given viewer guesses for an
    // undefined code rather than anything the document states.
    expect(pdf.includes(0x09)).toBe(false);
  });

  test('keeps numbered and bulleted list markers in visible text', async ({ page }) => {
    await page.goto('/docx-to-txt');
    await page.locator('#file-input').setInputFiles({
      name: 'numbered-list.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: numberedListDocx(),
    });

    await page.locator('#action-btn').click();
    await expect(page.locator('#dl-doc')).toBeVisible({ timeout: 30000 });

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#dl-doc').click();
    const download = await downloadPromise;
    const text = await readFile(await download.path(), 'utf8');

    expect(text).toBe([
      'Project checklist',
      '1. Prepare résumé 日本語',
      '2. Confirm café details',
      '2.a) Send link',
      '• Keep a backup',
    ].join('\n'));
  });

  test('keeps visible text inside valid WordprocessingML wrappers', async ({ page }) => {
    await page.goto('/docx-to-txt');
    await page.locator('#file-input').setInputFiles({
      name: 'nested-visible-text.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: nestedVisibleTextDocx(),
    });

    await page.locator('#action-btn').click();
    await expect(page.locator('#dl-doc')).toBeVisible({ timeout: 30000 });

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#dl-doc').click();
    const download = await downloadPromise;
    const text = await readFile(await download.path(), 'utf8');

    expect(text).toBe([
      'Before inserted ✓ after',
      'Line one',
      'Line two',
      'Label\tValue',
      'Docs',
      'Next',
      'Visible: controlled',
      'Keep new',
    ].join('\n'));
  });

  test('rejects malformed document XML instead of downloading an empty result', async ({ page }) => {
    const malformedDocx = storedZip({
      '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
      '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
      'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><',
    });

    await page.goto('/docx-to-txt');
    await page.locator('#file-input').setInputFiles({
      name: 'corrupt-document.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: malformedDocx,
    });

    await page.locator('#action-btn').click();
    const results = page.locator('#doc-results');
    await expect(results).toContainText('Failed to parse DOCX document content: the file may be corrupted.');
    await expect(page.locator('#dl-doc')).toHaveCount(0);
  });
});

test.describe('Archive Pages - Extract ZIP', () => {


  test('upload ZIP shows file', async ({ page }) => {
    await page.goto(`/extract-zip`);
    await page.locator('#file-input').setInputFiles(fixture('sample.zip'));
    const fileList = page.locator('#file-list');
    await expect(fileList).toBeVisible();
    const fileItem = fileList.locator('.file-item').first();
    await expect(fileItem).toBeVisible();
  });

  test('action button appears', async ({ page }) => {
    await page.goto(`/extract-zip`);
    await page.locator('#file-input').setInputFiles(fixture('sample.zip'));
    const actionBtn = page.locator('#action-btn');
    await expect(actionBtn).toBeVisible();
  });

  test('extract shows results', async ({ page }) => {
    await page.goto(`/extract-zip`);
    await page.locator('#file-input').setInputFiles(fixture('sample.zip'));
    await page.locator('#action-btn').click();
    const results = page.locator('#archive-results');
    await expect(results).toBeVisible({ timeout: 15000 });
  });

  test('individual download buttons exist', async ({ page }) => {
    await page.goto(`/extract-zip`);
    await page.locator('#file-input').setInputFiles(fixture('sample.zip'));
    await page.locator('#action-btn').click();
    await expect(page.locator('#archive-results')).toBeVisible({ timeout: 15000 });
    const dlBtns = page.locator('.dl-btn');
    await expect(dlBtns.first()).toBeVisible();
  });

  test('download all button for 2+ files', async ({ page }) => {
    await page.goto(`/extract-zip`);
    await page.locator('#file-input').setInputFiles(fixture('sample.zip'));
    await page.locator('#action-btn').click();
    await expect(page.locator('#archive-results')).toBeVisible({ timeout: 15000 });
    const dlAll = page.locator('#dl-all');
    await expect(dlAll).toBeVisible();
  });

  test('archive actions remain comfortable touch targets on narrow phones', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(`/extract-zip`);
    await page.locator('#file-input').setInputFiles(fixture('sample.zip'));
    await page.locator('#action-btn').click();
    await expect(page.locator('#archive-results')).toBeVisible({ timeout: 15000 });

    for (const selector of ['#action-btn', '#clear-all', '.btn-remove', '#dl-all', '.dl-btn']) {
      const box = await page.locator(selector).first().boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    await page.goto(`/create-zip`);
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));
    await page.locator('#action-btn').click();
    await expect(page.locator('#archive-results')).toBeVisible({ timeout: 15000 });
    const downloadBox = await page.locator('#dl-zip').boundingBox();
    expect(downloadBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test('clear all resets', async ({ page }) => {
    await page.goto(`/extract-zip`);
    await page.locator('#file-input').setInputFiles(fixture('sample.zip'));
    await expect(page.locator('#file-list')).toBeAttached();
    await page.locator('#clear-all').click();
    // #file-list is a static container: clearing empties it rather
    // than removing it.
    await expect(page.locator('#file-list .file-item')).toHaveCount(0);
  });

  test('second upload replaces first', async ({ page }) => {
    await page.goto(`/extract-zip`);
    await page.locator('#file-input').setInputFiles(fixture('sample.zip'));
    await expect(page.locator('#file-list .file-item')).toHaveCount(1);
    await page.locator('#file-input').setInputFiles(fixture('sample.zip'));
    await expect(page.locator('#file-list .file-item')).toHaveCount(1);
  });
});

test.describe('Archive Pages - Create ZIP', () => {


  test('upload single file', async ({ page }) => {
    await page.goto(`/create-zip`);
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));
    const fileList = page.locator('#file-list');
    await expect(fileList).toBeVisible();
    const fileItem = fileList.locator('.file-item').first();
    await expect(fileItem).toBeVisible();
  });

  test('upload multiple files', async ({ page }) => {
    await page.goto(`/create-zip`);
    await page.locator('#file-input').setInputFiles([fixture('sample.png'), fixture('sample.jpg')]);
    const items = page.locator('#file-list .file-item');
    await expect(items).toHaveCount(2);
  });

  test('action button appears', async ({ page }) => {
    await page.goto(`/create-zip`);
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));
    const actionBtn = page.locator('#action-btn');
    await expect(actionBtn).toBeVisible();
  });

  test('create ZIP produces result', async ({ page }) => {
    await page.goto(`/create-zip`);
    await page.locator('#file-input').setInputFiles([fixture('sample.png'), fixture('sample.jpg')]);
    await page.locator('#action-btn').click();
    const results = page.locator('#archive-results');
    await expect(results).toBeVisible({ timeout: 15000 });
  });

  test('ZIP download button exists', async ({ page }) => {
    await page.goto(`/create-zip`);
    await page.locator('#file-input').setInputFiles(fixture('sample.png'));
    await page.locator('#action-btn').click();
    await expect(page.locator('#archive-results')).toBeVisible({ timeout: 15000 });
    const dlZip = page.locator('#dl-zip');
    await expect(dlZip).toBeVisible();
  });

  test('remove individual file', async ({ page }) => {
    await page.goto(`/create-zip`);
    await page.locator('#file-input').setInputFiles([fixture('sample.png'), fixture('sample.jpg')]);
    await expect(page.locator('#file-list .file-item')).toHaveCount(2);
    const removeBtn = page.locator('.btn-remove').first();
    await removeBtn.click();
    await expect(page.locator('#file-list .file-item')).toHaveCount(1);
  });

  test('clear all resets', async ({ page }) => {
    await page.goto(`/create-zip`);
    await page.locator('#file-input').setInputFiles([fixture('sample.png'), fixture('sample.jpg')]);
    await expect(page.locator('#file-list .file-item')).toHaveCount(2);
    await page.locator('#clear-all').click();
    // #file-list is a static container: clearing empties it rather
    // than removing it.
    await expect(page.locator('#file-list .file-item')).toHaveCount(0);
  });
});

test.describe('PDF Merge', () => {
  test('single file disables action', async ({ page }) => {
    await page.goto(`/merge-pdf`);
    await page.locator('#file-input').setInputFiles(fixture('sample.pdf'));
    const actionBtn = page.locator('#action-btn');
    await expect(actionBtn).toBeDisabled();
  });

  test('two files enable action', async ({ page }) => {
    await page.goto(`/merge-pdf`);
    await page.locator('#file-input').setInputFiles([fixture('sample.pdf'), fixture('sample2.pdf')]);
    const actionBtn = page.locator('#action-btn');
    await expect(actionBtn).toBeEnabled();
  });

  test('drag handles visible in merge mode', async ({ page }) => {
    await page.goto(`/merge-pdf`);
    await page.locator('#file-input').setInputFiles([fixture('sample.pdf'), fixture('sample2.pdf')]);
    const dragHandles = page.locator('.drag-handle');
    await expect(dragHandles.first()).toBeVisible();
    await expect(dragHandles).toHaveCount(2);
  });

  test('remove reduces count', async ({ page }) => {
    await page.goto(`/merge-pdf`);
    await page.locator('#file-input').setInputFiles([fixture('sample.pdf'), fixture('sample2.pdf')]);
    await expect(page.locator('#file-list .file-item')).toHaveCount(2);
    await expect(page.locator('#action-btn')).toBeEnabled();
    const removeBtn = page.locator('.btn-remove').first();
    await removeBtn.click();
    await expect(page.locator('#file-list .file-item')).toHaveCount(1);
    await expect(page.locator('#action-btn')).toBeDisabled();
  });
});

test.describe('PDF Split', () => {
  test('upload PDF shows file', async ({ page }) => {
    await page.goto(`/split-pdf`);
    await page.locator('#file-input').setInputFiles(fixture('sample.pdf'));
    const fileList = page.locator('#file-list');
    await expect(fileList).toBeVisible();
    const fileItem = fileList.locator('.file-item').first();
    await expect(fileItem).toBeVisible();
  });

  test('only accepts single file', async ({ page }) => {
    await page.goto(`/split-pdf`);
    await page.locator('#file-input').setInputFiles(fixture('sample.pdf'));
    await expect(page.locator('#file-list .file-item')).toHaveCount(1);
    await page.locator('#file-input').setInputFiles(fixture('sample2.pdf'));
    await expect(page.locator('#file-list .file-item')).toHaveCount(1);
  });
});

test.describe('PDF OCR', () => {
  test('language selector populated', async ({ page }) => {
    await page.goto(`/pdf-ocr`);
    const langSelector = page.locator('#ocr-lang');
    await expect(langSelector).toBeAttached();
    const options = langSelector.locator('option');
    const count = await options.count();
    expect(count).toBeGreaterThan(0);
  });

  test('copy button exists', async ({ page }) => {
    await page.goto(`/pdf-ocr`);
    const copyBtn = page.locator('#ocr-copy');
    await expect(copyBtn).toBeAttached();
  });

  test('download button exists', async ({ page }) => {
    await page.goto(`/pdf-ocr`);
    const dlBtn = page.locator('#ocr-download');
    await expect(dlBtn).toBeAttached();
  });

  test('progress area hidden initially', async ({ page }) => {
    await page.goto(`/pdf-ocr`);
    const progress = page.locator('#ocr-progress');
    await expect(progress).not.toBeVisible();
  });

  test('results area hidden initially', async ({ page }) => {
    await page.goto(`/pdf-ocr`);
    const results = page.locator('#ocr-results');
    await expect(results).not.toBeVisible();
  });
});
