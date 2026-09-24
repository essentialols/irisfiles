/**
 * IrisFiles - Archive member name safety
 *
 * ZIP member names are paths, not display labels. Every ZIP-writing sink
 * (`archive-engine.js` createZip, `converter.js` downloadAsZip) allocates its
 * names through this module, so a downloaded archive cannot carry traversal,
 * absolute, drive-qualified, device-reserved or direction-spoofing paths into
 * a later filesystem extraction step, and cannot contain two members that
 * collapse onto one file when written out.
 */

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
// Bidi marks, overrides and isolates: a member holding U+202E renders reversed
// in the results list and in the user's file manager, so "photo\u202egnp.exe"
// reads as a PNG and executes as an EXE.
const DIRECTION = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
// ':' is an NTFS alternate-data-stream separator as well as a drive qualifier.
const WINDOWS_INVALID = /[<>:"|?*]/g;
const DRIVE_PREFIX = /^[A-Za-z]:/;
const RESERVED_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const TRAILING_DOT_SPACE = /[. ]+$/;

const MAX_SEGMENT_BYTES = 255; // ext4, APFS and NTFS component limit
const MAX_PATH_BYTES = 1024;

const encoder = new TextEncoder();

function byteLength(value) {
  return encoder.encode(value).length;
}

function sliceBytes(value, maxBytes) {
  let out = '';
  let used = 0;
  for (const char of value) {
    // Iterating the string yields whole code points, so a surrogate pair is
    // never cut in half.
    const size = byteLength(char);
    if (used + size > maxBytes) break;
    out += char;
    used += size;
  }
  return out;
}

function truncateSegment(value) {
  if (byteLength(value) <= MAX_SEGMENT_BYTES) return value;
  const dot = value.lastIndexOf('.');
  let ext = dot > 0 ? value.slice(dot) : '';
  if (byteLength(ext) > 32) ext = '';
  const stem = ext ? value.slice(0, value.length - ext.length) : value;
  return sliceBytes(stem, MAX_SEGMENT_BYTES - byteLength(ext)) + ext;
}

/**
 * Reduce one path component to something every target filesystem can hold.
 * Applied per segment, never to the joined string: a drive qualifier or a
 * device name is dangerous wherever it appears, not only at index 0.
 * @param {string} segment
 * @returns {string} sanitized segment, '' when nothing safe is left
 */
function sanitizeSegment(segment) {
  let out = segment.replace(CONTROL, '').replace(DIRECTION, '');
  out = out.replace(DRIVE_PREFIX, '');
  out = out.replace(WINDOWS_INVALID, '_');
  out = truncateSegment(out);
  // Windows silently drops trailing dots and spaces when writing, so "evil.txt "
  // and "evil.txt" are the same file there but two members here.
  out = out.replace(TRAILING_DOT_SPACE, '');
  if (!out) return '';

  const dot = out.indexOf('.');
  const stem = dot === -1 ? out : out.slice(0, dot);
  if (RESERVED_DEVICE.test(stem)) {
    out = dot === -1 ? `${out}_` : `${stem}_${out.slice(dot)}`;
  }
  return out;
}

/**
 * True when the joined result is a plain relative path. The per-segment pass is
 * the only thing between a hostile member name and path.resolve() on the
 * extractor side, so the result is re-validated rather than assumed.
 * @param {string} name
 * @returns {boolean}
 */
export function isSafeArchivePath(name) {
  if (name === '') return true;
  if (name.startsWith('/') || name.includes('\\') || name.includes(':')) return false;
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) return false;
  if (/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(name)) return false;
  return name.split('/').every(segment =>
    segment !== '' &&
    segment !== '.' &&
    segment !== '..' &&
    !DRIVE_PREFIX.test(segment) &&
    byteLength(segment) <= MAX_SEGMENT_BYTES
  );
}

/**
 * Normalize an archive member name to a safe relative path.
 * @param {string} name - raw ZIP member name or File.name
 * @returns {string} relative path, '' when nothing safe is left
 */
export function safeArchiveName(name) {
  const parts = [];

  for (const raw of String(name).replace(/\\/g, '/').split('/')) {
    // Strip invisible characters before comparing, so ".\u0000." cannot smuggle
    // a traversal segment past the equality checks.
    const stripped = raw.replace(CONTROL, '').replace(DIRECTION, '');
    if (stripped === '' || stripped === '.') continue;
    if (stripped === '..') {
      if (parts.length) parts.pop();
      continue;
    }
    const part = sanitizeSegment(stripped);
    if (!part) continue;
    parts.push(part);
  }

  // Every segment already fits its own cap, so dropping leading directories
  // terminates with at least the basename.
  while (parts.length > 1 && byteLength(parts.join('/')) > MAX_PATH_BYTES) parts.shift();

  const result = parts.join('/');
  return isSafeArchivePath(result) ? result : '';
}

/**
 * True when the raw name carried something genuinely dangerous, as opposed to a
 * cosmetic rewrite such as "nested/./keep.txt" or a directory entry's trailing
 * slash. Drives the "unsafe paths normalized" notice, so it must not inflate.
 * @param {string} name
 * @returns {boolean}
 */
export function isUnsafeArchiveName(name) {
  const raw = String(name);
  if (/[\u0000-\u001f\u007f-\u009f]/.test(raw)) return true;
  if (/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(raw)) return true;
  if (raw.includes('\\')) return true; // a Windows path separator, not a filename character

  const normalized = raw.replace(/\\/g, '/');
  if (normalized.startsWith('/')) return true;

  for (const segment of normalized.split('/')) {
    if (segment === '..') return true;
    if (segment === '' || segment === '.') continue;
    if (DRIVE_PREFIX.test(segment)) return true;
    if (/[<>:"|?*]/.test(segment)) return true;
    if (TRAILING_DOT_SPACE.test(segment)) return true;
    if (RESERVED_DEVICE.test(segment.split('.')[0])) return true;
    if (byteLength(segment) > MAX_SEGMENT_BYTES) return true;
  }
  return false;
}

/**
 * Allocation state for one archive. Names are allocated against a canonical
 * key (NFC + lowercase) because "ESCAPE.TXT" and "escape.txt", or the NFC and
 * NFD spellings of "résumé.txt", are distinct ZIP members that collapse onto
 * one file on macOS and Windows.
 * @returns {{files: Set<string>, dirs: Set<string>, dirMap: Map<string, string>}}
 */
export function createArchiveNames() {
  return { files: new Set(), dirs: new Set(), dirMap: new Map() };
}

function canonicalKey(name) {
  return name.normalize('NFC').toLowerCase();
}

function join(prefix, segment) {
  return prefix ? `${prefix}/${segment}` : segment;
}

function suffixed(filename, suffix) {
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  return `${stem} (${suffix})${ext}`;
}

/**
 * Reserve a name for one member, renaming it when it would overwrite or shadow
 * an already reserved path. Ancestor directories are reserved too, so a member
 * named "a" can never swallow the "a/b.txt" tree, nor the reverse.
 * @param {string} name - output of safeArchiveName()
 * @param {ReturnType<typeof createArchiveNames>} registry
 * @returns {string}
 */
export function uniqueArchiveName(name, registry) {
  const segments = String(name).split('/');
  const base = segments.pop();

  let allocated = '';
  let source = '';
  for (const segment of segments) {
    source = join(source, segment);
    const mapped = registry.dirMap.get(canonicalKey(source));
    if (mapped !== undefined) {
      allocated = mapped;
      continue;
    }
    let candidate = join(allocated, segment);
    let suffix = 2;
    while (registry.files.has(canonicalKey(candidate))) {
      candidate = join(allocated, suffixed(segment, suffix++));
    }
    allocated = candidate;
    registry.dirs.add(canonicalKey(allocated));
    registry.dirMap.set(canonicalKey(source), allocated);
  }

  let candidate = join(allocated, base);
  let suffix = 2;
  while (registry.files.has(canonicalKey(candidate)) || registry.dirs.has(canonicalKey(candidate))) {
    candidate = join(allocated, suffixed(base, suffix++));
  }
  registry.files.add(canonicalKey(candidate));
  return candidate;
}
