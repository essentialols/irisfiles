/**
 * IrisFiles - Archive engine
 * ZIP extraction and creation using fflate (window.fflate from js/fflate.min.js).
 */
import { safeArchiveName, isUnsafeArchiveName, createArchiveNames, uniqueArchiveName } from './archive-name.js';

/**
 * Extract all files from a ZIP archive.
 * @param {File} file - ZIP file
 * @param {function} onProgress - Progress callback (0-100)
 * @returns {Promise<Array<{name: string, blob: Blob, size: number, pathSanitized: boolean}>>}
 */
export async function extractZip(file, onProgress) {
  if (onProgress) onProgress(10);
  const buffer = await file.arrayBuffer();
  if (onProgress) onProgress(30);

  if (typeof fflate === 'undefined') throw new Error('ZIP library not loaded. Please reload the page.');
  const extracted = await unzipEntries(new Uint8Array(buffer));
  if (onProgress) onProgress(80);

  const entries = [];
  const names = createArchiveNames();
  for (const { name: rawName, data } of extracted) {
    // Skip directory entries (they end with / and have zero length)
    if (rawName.endsWith('/') && data.length === 0) continue;
    const safeName = safeArchiveName(rawName) || 'unnamed';
    entries.push({
      name: uniqueArchiveName(safeName, names),
      blob: new Blob([data]),
      size: data.length,
      // Only genuinely dangerous rewrites, so the notice count is not inflated
      // by a cosmetic one such as "nested/./keep.txt".
      pathSanitized: isUnsafeArchiveName(rawName),
    });
  }

  if (onProgress) onProgress(100);
  return entries;
}

/**
 * Extract ZIP members while retaining the strict validation performed by
 * unzipSync(). The common unique-name path keeps the existing one-pass result.
 * Only archives whose central-directory count cannot match the filename map
 * take the streaming fallback needed to preserve duplicate member names.
 * @param {Uint8Array} raw
 * @returns {Promise<Array<{name: string, data: Uint8Array}>>}
 */
async function unzipEntries(raw) {
  const unique = fflate.unzipSync(raw);
  const entries = Object.entries(unique).map(([name, data]) => ({ name, data }));
  const directoryCount = zipCentralDirectoryEntryCount(raw);

  // 0xffff is the ZIP64 sentinel. Stream ZIP64 archives as well so we do not
  // mistake the 16-bit compatibility count for the real member count.
  if (directoryCount !== 0xffff && directoryCount === entries.length) return entries;
  return unzipEntriesPreservingDuplicates(raw);
}

function zipCentralDirectoryEntryCount(raw) {
  const min = Math.max(0, raw.length - 65558); // EOCD + maximum 65,535-byte comment
  for (let pos = raw.length - 22; pos >= min; pos--) {
    if (raw[pos] !== 0x50 || raw[pos + 1] !== 0x4b || raw[pos + 2] !== 0x05 || raw[pos + 3] !== 0x06) continue;
    return raw[pos + 10] | (raw[pos + 11] << 8);
  }
  return null;
}

/**
 * Stream every ZIP member so duplicate paths are not collapsed into object keys.
 * fflate.unzipSync() returns an object keyed by filename, which silently drops
 * earlier members when an archive contains the same path more than once.
 * @param {Uint8Array} raw
 * @returns {Promise<Array<{name: string, data: Uint8Array}>>}
 */
function unzipEntriesPreservingDuplicates(raw) {
  return new Promise((resolve, reject) => {
    const extracted = [];
    let pending = 0;
    let inputComplete = false;
    let settled = false;

    const resolveIfDone = () => {
      if (inputComplete && pending === 0 && !settled) {
        settled = true;
        resolve(extracted);
      }
    };
    const fail = err => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    const unzipper = new fflate.Unzip(file => {
      pending++;
      const chunks = [];
      let size = 0;

      file.ondata = (err, chunk, final) => {
        if (err) {
          fail(err);
          return;
        }
        if (chunk && chunk.length) {
          chunks.push(chunk);
          size += chunk.length;
        }
        if (!final) return;

        const data = new Uint8Array(size);
        let offset = 0;
        for (const part of chunks) {
          data.set(part, offset);
          offset += part.length;
        }
        extracted.push({ name: file.name, data });
        pending--;
        resolveIfDone();
      };

      try {
        file.start();
      } catch (err) {
        pending--;
        fail(err);
      }
    });

    // Stored entries are supported by Unzip itself; register DEFLATE, the
    // compression method used by ordinary ZIP archives.
    unzipper.register(fflate.UnzipInflate);

    try {
      unzipper.push(raw, true);
      inputComplete = true;
      resolveIfDone();
    } catch (err) {
      fail(err);
    }
  });
}

/**
 * Create a ZIP archive from multiple files.
 * @param {Array<{name: string, blob: Blob}>} files
 * @param {function} onProgress - Progress callback (0-100)
 * @returns {Promise<Blob>}
 */
export async function createZip(files, onProgress) {
  const zipInput = Object.create(null);
  const names = createArchiveNames();

  for (let i = 0; i < files.length; i++) {
    const buffer = await files[i].blob.arrayBuffer();
    const safeName = safeArchiveName(files[i].name) || 'unnamed';
    const name = uniqueArchiveName(safeName, names);
    zipInput[name] = new Uint8Array(buffer);
    if (onProgress) onProgress(Math.round(((i + 1) / files.length) * 60));
  }

  if (typeof fflate === 'undefined') throw new Error('ZIP library not loaded. Please reload the page.');
  const zipped = fflate.zipSync(zipInput);
  if (onProgress) onProgress(90);

  const blob = new Blob([zipped], { type: 'application/zip' });
  if (onProgress) onProgress(100);
  return blob;
}

