/**
 * IrisFiles - Archive member name safety
 *
 * ZIP member names are paths, not display labels. A hostile name ("../x",
 * "/etc/x", "C:\x", "con") that is copied into a ZIP we write becomes a
 * traversal or device path the moment the user extracts that ZIP. Extracted
 * entries are re-zipped by archive-engine.js createZip, so every member name
 * passes through here first.
 */

// C0/C1 controls plus bidi marks, overrides and isolates: U+202E makes
// "photo\u202egnp.exe" render as a PNG and run as an EXE.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
// ':' is an NTFS alternate-data-stream separator as well as a drive qualifier.
const WINDOWS_INVALID = /[<>:"|?*]/g;
const DRIVE_PREFIX = /^[A-Za-z]:/;
const RESERVED_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Reduce one path component to something every target filesystem can hold.
 * Applied per segment, never to the joined string: a drive qualifier or a
 * device name is dangerous wherever it appears, not only at index 0.
 * @param {string} segment - already stripped of invisible characters
 * @returns {string} sanitized segment, '' when nothing safe is left
 */
function sanitizeSegment(segment) {
  // Windows silently drops trailing dots and spaces when writing, so "evil.txt "
  // and "evil.txt" are the same file there but two members here.
  const out = segment
    .replace(DRIVE_PREFIX, '')
    .replace(WINDOWS_INVALID, '_')
    .replace(/[. ]+$/, '');
  if (!out) return '';

  const dot = out.indexOf('.');
  const stem = dot === -1 ? out : out.slice(0, dot);
  return RESERVED_DEVICE.test(stem) ? `${stem}_${dot === -1 ? '' : out.slice(dot)}` : out;
}

/**
 * Normalize an archive member name to a safe relative path.
 * @param {string} name - raw ZIP member name or File.name
 * @returns {string} relative path, 'unnamed' when nothing safe is left
 */
export function safeArchiveName(name) {
  const parts = [];
  for (const raw of String(name).replace(/\\/g, '/').split('/')) {
    // Strip invisible characters before comparing, so ".\u0000." cannot smuggle
    // a traversal segment past the equality checks.
    const segment = raw.replace(INVISIBLE, '');
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      parts.pop();
      continue;
    }
    const safe = sanitizeSegment(segment);
    if (safe) parts.push(safe);
  }
  return parts.join('/') || 'unnamed';
}

/**
 * Reserve a unique name in `usedKeys`, appending " (n)" before the extension
 * on a collision. The key is NFC + lowercase because "ESCAPE.TXT" and
 * "escape.txt", or the NFC and NFD spellings of "résumé.txt", are distinct ZIP
 * members that collapse onto one file on macOS and Windows.
 * @param {string} name - output of safeArchiveName()
 * @param {Set<string>} usedKeys - one per archive
 * @returns {string}
 */
export function uniqueArchiveName(name, usedKeys) {
  const key = value => value.normalize('NFC').toLowerCase();
  let candidate = name;

  if (usedKeys.has(key(candidate))) {
    const slash = name.lastIndexOf('/');
    const dir = name.slice(0, slash + 1);
    const filename = name.slice(slash + 1);
    const dot = filename.lastIndexOf('.');
    const stem = dot > 0 ? filename.slice(0, dot) : filename;
    const ext = dot > 0 ? filename.slice(dot) : '';
    let suffix = 2;
    do {
      candidate = `${dir}${stem} (${suffix++})${ext}`;
    } while (usedKeys.has(key(candidate)));
  }

  usedKeys.add(key(candidate));
  return candidate;
}
