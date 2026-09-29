/**
 * Unit spec for js/archive-name.js, the ZIP member-name sanitizer used by
 * archive-engine.js extractZip and createZip.
 *
 * Path-safety properties, not browser behaviour: a function call proves each
 * case, where an e2e round trip would cost a page load per edge case.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeArchiveName, uniqueArchiveName } from '../js/archive-name.js';

const RLO = '\u202e';

test('removes traversal, absolute and separator tricks', () => {
  const cases = {
    '../escape.txt': 'escape.txt',
    'safe/../../escape.txt': 'escape.txt',
    'a/b/../c.txt': 'a/c.txt',
    '..\\windows.txt': 'windows.txt',
    '/absolute.txt': 'absolute.txt',
    '....//escape.txt': 'escape.txt',
    '.\u0000./escape.txt': 'escape.txt', // a control char must not hide a ".."
  };
  for (const [raw, safe] of Object.entries(cases)) assert.equal(safeArchiveName(raw), safe, raw);
});

test('strips drive qualifiers wherever they appear', () => {
  assert.equal(safeArchiveName('C:/drive.txt'), 'drive.txt');
  assert.equal(safeArchiveName('/C:/drive.txt'), 'drive.txt');
  assert.equal(safeArchiveName('..\\C:\\x.txt'), 'x.txt');
  assert.equal(safeArchiveName('a/C:/b.txt'), 'a/b.txt');
  // A colon that is not drive syntax is an NTFS stream separator: replaced.
  assert.equal(safeArchiveName('a/note:stream.txt'), 'a/note_stream.txt');
});

test('strips control and direction-spoofing characters', () => {
  assert.equal(safeArchiveName(`photo${RLO}gnp.exe`), 'photognp.exe');
  assert.equal(safeArchiveName('a\u0007b\u009fc.txt'), 'abc.txt');
});

test('neutralizes reserved device names and trailing dots or spaces', () => {
  assert.equal(safeArchiveName('CON'), 'CON_');
  assert.equal(safeArchiveName('com1.txt'), 'com1_.txt');
  assert.equal(safeArchiveName('dir/LPT9.log'), 'dir/LPT9_.log');
  assert.equal(safeArchiveName('console.txt'), 'console.txt');
  assert.equal(safeArchiveName('dir /file. '), 'dir/file');
});

test('leaves legitimate names alone', () => {
  for (const name of ['a.txt', 'docs/sub dir/readme.md', '.gitignore', 'r\u00e9sum\u00e9.txt', '日本語/x.txt', 'v1.2.3/a-b_c (1).txt']) {
    assert.equal(safeArchiveName(name), name);
  }
});

test('never returns an empty name', () => {
  for (const raw of ['', '.', '..', '...', '//', '../..', 'C:']) assert.equal(safeArchiveName(raw), 'unnamed', raw);
});

test('renames collisions, including ones sanitizing creates or case and Unicode folding hides', () => {
  const used = new Set();
  const out = ['report.txt', 'report.txt', '../report.txt', 'REPORT.TXT', 'dir/a', 'dir/a']
    .map(raw => uniqueArchiveName(safeArchiveName(raw), used));
  assert.deepEqual(out, ['report.txt', 'report (2).txt', 'report (3).txt', 'REPORT (4).TXT', 'dir/a', 'dir/a (2)']);

  // NFC and NFD spellings are one file on macOS.
  const uni = new Set();
  assert.equal(uniqueArchiveName('r\u00e9sum\u00e9.txt', uni), 'r\u00e9sum\u00e9.txt');
  assert.equal(uniqueArchiveName('re\u0301sume\u0301.txt', uni), 're\u0301sume\u0301 (2).txt');
});
