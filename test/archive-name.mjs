/**
 * Unit spec for js/archive-name.js, the ZIP member-name sanitizer shared by
 * archive-engine.js createZip and converter.js downloadAsZip.
 *
 * These are path-safety properties, not browser behaviour, so they belong in a
 * plain Node spec: the e2e suite runs serially and a browser round trip per
 * edge case would cost minutes to assert what a function call proves.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  safeArchiveName,
  isSafeArchivePath,
  isUnsafeArchiveName,
  createArchiveNames,
  uniqueArchiveName,
} from '../js/archive-name.js';

const RLO = '\u202e';

test('strips drive qualifiers wherever they appear, not only at index 0', () => {
  assert.equal(safeArchiveName('C:/drive.txt'), 'drive.txt');
  assert.equal(safeArchiveName('/C:/drive.txt'), 'drive.txt');
  assert.equal(safeArchiveName('./C:/x.txt'), 'x.txt');
  assert.equal(safeArchiveName('..\\C:\\x.txt'), 'x.txt');
  assert.equal(safeArchiveName('\\\\?\\C:\\evil.txt'), '_/evil.txt');
  assert.equal(safeArchiveName('a/C:/b.txt'), 'a/b.txt');
  // "b:" is drive syntax too; a colon that cannot be one becomes an underscore
  // so no segment carries an NTFS alternate-data-stream separator.
  assert.equal(safeArchiveName('a/b:stream.txt'), 'a/stream.txt');
  assert.equal(safeArchiveName('a/note:stream.txt'), 'a/note_stream.txt');
});

test('removes traversal and absolute prefixes', () => {
  assert.equal(safeArchiveName('../escape.txt'), 'escape.txt');
  assert.equal(safeArchiveName('safe/../../escape.txt'), 'escape.txt');
  assert.equal(safeArchiveName('..\\windows.txt'), 'windows.txt');
  assert.equal(safeArchiveName('/absolute.txt'), 'absolute.txt');
  assert.equal(safeArchiveName('nested/./keep.txt'), 'nested/keep.txt');
  assert.equal(safeArchiveName('....//escape.txt'), 'escape.txt');
  // A control character must not smuggle a traversal segment past the check.
  assert.equal(safeArchiveName('.\u0000./escape.txt'), 'escape.txt');
});

test('strips direction-spoofing characters', () => {
  assert.equal(safeArchiveName(`photo${RLO}gnp.exe`), 'photognp.exe');
  assert.equal(safeArchiveName('a\u200fb\u2066c\u2069.txt'), 'abc.txt');
  assert.equal(isUnsafeArchiveName(`photo${RLO}gnp.exe`), true);
});

test('strips C0 and C1 control characters', () => {
  assert.equal(safeArchiveName('a\u0007b\u009fc.txt'), 'abc.txt');
  assert.equal(isUnsafeArchiveName('a\u009fc.txt'), true);
});

test('neutralizes Windows reserved device names and trailing dots or spaces', () => {
  assert.equal(safeArchiveName('CON'), 'CON_');
  assert.equal(safeArchiveName('com1.txt'), 'com1_.txt');
  assert.equal(safeArchiveName('dir/LPT9.log'), 'dir/LPT9_.log');
  assert.equal(safeArchiveName('console.txt'), 'console.txt');
  assert.equal(safeArchiveName('foo.'), 'foo');
  assert.equal(safeArchiveName('foo '), 'foo');
  assert.equal(safeArchiveName('dir /file. '), 'dir/file');
});

test('caps segment and total path length', () => {
  const long = 'a'.repeat(400) + '.txt';
  const capped = safeArchiveName(long);
  assert.ok(Buffer.byteLength(capped) <= 255, `segment was ${Buffer.byteLength(capped)} bytes`);
  assert.ok(capped.endsWith('.txt'));

  const multibyte = safeArchiveName('\u00e9'.repeat(300) + '.txt');
  assert.ok(Buffer.byteLength(multibyte) <= 255);
  assert.equal(multibyte.normalize('NFC'), multibyte, 'truncation must not split a code point');

  const deep = Array.from({ length: 40 }, (_, i) => `dir${i}`.padEnd(100, 'x')).join('/') + '/leaf.txt';
  const trimmed = safeArchiveName(deep);
  assert.ok(Buffer.byteLength(trimmed) <= 1024, `path was ${Buffer.byteLength(trimmed)} bytes`);
  assert.ok(trimmed.endsWith('leaf.txt'));
});

test('every sanitized name satisfies isSafeArchivePath', () => {
  const hostile = [
    'C:/drive.txt', '/C:/drive.txt', './C:/x.txt', '..\\C:\\x.txt', '\\\\?\\C:\\evil.txt',
    '../escape.txt', 'safe/../../escape.txt', '/absolute.txt', '..', '.', '...', '//',
    `bad${RLO}.txt`, 'CON', 'com1.txt', 'a:b:c', 'x\u0000y', 'foo. . .', '\\\\server\\share\\f.txt',
    'a'.repeat(400), '', 'a/b/../../../../c.txt',
  ];
  for (const name of hostile) {
    const safe = safeArchiveName(name);
    assert.ok(isSafeArchivePath(safe), `${JSON.stringify(name)} produced ${JSON.stringify(safe)}`);
    assert.ok(!safe.startsWith('/'), safe);
    assert.ok(!safe.includes('\\'), safe);
    assert.ok(!/(^|\/)\.\.(\/|$)/.test(safe), safe);
    assert.ok(!/^[A-Za-z]:/.test(safe), safe);
  }
});

test('flags only genuinely unsafe rewrites', () => {
  for (const unsafe of ['../a.txt', '/a.txt', 'C:/a.txt', 'a\\b.txt', 'CON', 'foo. ', 'a:b', `x${RLO}y`]) {
    assert.equal(isUnsafeArchiveName(unsafe), true, unsafe);
  }
  for (const benign of ['a.txt', 'nested/./keep.txt', 'dir/', 'a//b.txt', 'résumé.txt', '日本語/x.txt']) {
    assert.equal(isUnsafeArchiveName(benign), false, benign);
  }
});

test('allocates against a canonical key so case and Unicode folding cannot overwrite', () => {
  const names = createArchiveNames();
  assert.equal(uniqueArchiveName('escape.txt', names), 'escape.txt');
  assert.equal(uniqueArchiveName('ESCAPE.TXT', names), 'ESCAPE (2).TXT');
  // The original spelling is emitted; only the allocation key is folded, so the
  // NFD member keeps its own bytes and the NFC member is the one that moves.
  assert.equal(uniqueArchiveName('re\u0301sume\u0301.txt', names), 're\u0301sume\u0301.txt');
  assert.equal(uniqueArchiveName('r\u00e9sum\u00e9.txt', names), 'r\u00e9sum\u00e9 (2).txt');
  assert.equal(uniqueArchiveName('report.txt', names), 'report.txt');
  assert.equal(uniqueArchiveName('report.txt', names), 'report (2).txt');
  assert.equal(uniqueArchiveName('report.txt', names), 'report (3).txt');
});

test('reserves ancestors so a file cannot shadow a directory', () => {
  const fileFirst = createArchiveNames();
  assert.equal(uniqueArchiveName('a', fileFirst), 'a');
  assert.equal(uniqueArchiveName('a/b.txt', fileFirst), 'a (2)/b.txt');
  assert.equal(uniqueArchiveName('a/c.txt', fileFirst), 'a (2)/c.txt', 'siblings stay in one directory');

  const dirFirst = createArchiveNames();
  assert.equal(uniqueArchiveName('evil/x.txt', dirFirst), 'evil/x.txt');
  // A directory entry carrying data normalizes to a file named "evil".
  assert.equal(uniqueArchiveName('evil', dirFirst), 'evil (2)');

  const nested = createArchiveNames();
  assert.equal(uniqueArchiveName('a/b', nested), 'a/b');
  assert.equal(uniqueArchiveName('A/B/c.txt', nested), 'a/B (2)/c.txt');
});

test('produces a distinct output for every distinct input', () => {
  const members = [
    'report.txt', 'report.txt', 'REPORT.TXT', '../report.txt', 'C:/report.txt',
    'a', 'a/b.txt', 'evil/', 'evil/x.txt', 'con', 'CON', 'foo.', 'foo',
  ];
  const names = createArchiveNames();
  const allocated = members.map(name => uniqueArchiveName(safeArchiveName(name) || 'unnamed', names));
  const keys = allocated.map(name => name.normalize('NFC').toLowerCase());
  assert.equal(new Set(keys).size, members.length, `collision in ${JSON.stringify(allocated)}`);
});
