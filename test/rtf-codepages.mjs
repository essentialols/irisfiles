/**
 * Unit spec for the RTF \ansicpg handling in js/doc-engine.js.
 *
 * \'xx escapes are bytes in the declared ANSI code page. doc-engine.js has no
 * DOM at load time, so rtfToText runs here directly instead of costing a page
 * load per code page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rtfToText } from '../js/doc-engine.js';

async function convert(header, bytes, tail = '') {
  const body = bytes.map(b => "\\'" + b.toString(16).padStart(2, '0')).join('');
  const rtf = '{\\rtf1\\ansi' + header + ' ' + body + tail + '}';
  return (await rtfToText(new Blob([rtf]))).text();
}

test('single-byte Windows code pages decode with the declared page', async () => {
  assert.equal(await convert('\\ansicpg1250', [90, 97, 191, 243, 179, 230]), 'Zażółć');
  assert.equal(await convert('\\ansicpg1251', [207, 240, 232, 226, 229, 242]), 'Привет');
  assert.equal(await convert('\\ansicpg1253', [193, 235, 246, 225]), 'Αλφα');
  assert.equal(await convert('\\ansicpg1252', [233]), 'é');
});

test('a code page without a single-byte decoder keeps the byte-for-byte fallback', async () => {
  assert.equal(await convert('\\ansicpg932', [233]), 'é');
});

test('\\uN escapes are unaffected by the declared code page', async () => {
  assert.equal(await convert('\\ansicpg1251', [207], ' \\u1081?'), 'П й');
});
