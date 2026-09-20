/**
 * IrisFiles - Archive engine
 * ZIP extraction and creation using fflate (window.fflate from js/fflate.min.js).
 */

/**
 * Extract all files from a ZIP archive.
 * @param {File} file - ZIP file
 * @param {function} onProgress - Progress callback (0-100)
 * @returns {Promise<Array<{name: string, blob: Blob, size: number}>>}
 */
export async function extractZip(file, onProgress) {
  if (onProgress) onProgress(10);
  const buffer = await file.arrayBuffer();
  if (onProgress) onProgress(30);

  if (typeof fflate === 'undefined') throw new Error('ZIP library not loaded. Please reload the page.');
  const extracted = await unzipEntriesPreservingDuplicates(new Uint8Array(buffer));
  if (onProgress) onProgress(80);

  const entries = [];
  const usedNames = new Set();
  for (const { name: rawName, data } of extracted) {
    // Skip directory entries (they end with / and have zero length)
    if (rawName.endsWith('/') && data.length === 0) continue;
    entries.push({
      name: uniqueArchiveName(rawName, usedNames),
      blob: new Blob([data]),
      size: data.length,
    });
  }

  if (onProgress) onProgress(100);
  return entries;
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
  const usedNames = new Set();

  for (let i = 0; i < files.length; i++) {
    const buffer = await files[i].blob.arrayBuffer();
    const name = uniqueArchiveName(files[i].name, usedNames);
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

function uniqueArchiveName(name, usedNames) {
  if (!usedNames.has(name)) {
    usedNames.add(name);
    return name;
  }

  const slash = name.lastIndexOf('/');
  const dir = slash === -1 ? '' : name.slice(0, slash + 1);
  const filename = slash === -1 ? name : name.slice(slash + 1);
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';

  let suffix = 2;
  let candidate;
  do {
    candidate = `${dir}${stem} (${suffix})${ext}`;
    suffix++;
  } while (usedNames.has(candidate));

  usedNames.add(candidate);
  return candidate;
}

/**
 * List files inside a ZIP without keeping extracted data.
 * fflate has no list-only mode, so this does a full unzip and returns metadata.
 * @param {File} file - ZIP file
 * @returns {Promise<Array<{name: string, compressedSize: number, uncompressedSize: number}>>}
 */
export async function zipToFileList(file) {
  if (typeof fflate === 'undefined') throw new Error('ZIP library not loaded. Please reload the page.');
  const buffer = await file.arrayBuffer();
  const raw = new Uint8Array(buffer);
  const unzipped = fflate.unzipSync(raw);

  const entries = [];
  for (const [name, data] of Object.entries(unzipped)) {
    if (name.endsWith('/') && data.length === 0) continue;
    entries.push({
      name,
      compressedSize: 0, // fflate doesn't expose per-entry compressed sizes
      uncompressedSize: data.length,
    });
  }
  return entries;
}
