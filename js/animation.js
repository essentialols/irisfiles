/**
 * IrisFiles - Animated image detection.
 * Canvas draws only the first frame, so tools that re-encode through it use this to
 * refuse animated input instead of silently flattening it. Magic bytes, not extensions.
 */

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

export async function pngAnimationFrameCount(file) {
  // APNG puts acTL before the first IDAT. Read chunk headers only so large
  // still PNGs are not copied into memory merely to prove they are static.
  let offset = 8;
  while (offset + 12 <= file.size) {
    const header = new Uint8Array(await file.slice(offset, offset + 8).arrayBuffer());
    if (header.length < 8) break;
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const length = view.getUint32(0, false);
    const type = String.fromCharCode(header[4], header[5], header[6], header[7]);
    if (length > file.size - offset - 12) break;
    if (type === 'acTL' && length >= 8) {
      const data = new DataView(await file.slice(offset + 8, offset + 12).arrayBuffer());
      return data.getUint32(0, false);
    }
    if (type === 'IDAT' || type === 'IEND') break;
    offset += length + 12;
  }
  return 1;
}

// Walk the block structure and stop at the second image descriptor.
async function gifFrameCount(file) {
  const b = new Uint8Array(await file.arrayBuffer());
  let pos = 13 + ((b[10] & 0x80) ? 3 << ((b[10] & 7) + 1) : 0);
  let frames = 0;
  const skipSubBlocks = () => {
    while (pos < b.length) {
      const size = b[pos++];
      if (!size) return;
      pos += size;
    }
  };
  while (pos < b.length) {
    const marker = b[pos++];
    if (marker === 0x21) {
      pos++; // extension label
      skipSubBlocks();
    } else if (marker === 0x2c) {
      if (++frames > 1) return frames;
      const packed = b[pos + 8];
      // descriptor (9) + local palette + LZW minimum code size (1)
      pos += 9 + ((packed & 0x80) ? 3 << ((packed & 7) + 1) : 0) + 1;
      skipSubBlocks();
    } else {
      break; // trailer (0x3b) or anything unparseable
    }
  }
  return frames;
}

/**
 * @param {File|Blob} file
 * @returns {Promise<string|null>} 'GIF', 'WebP' or 'PNG (APNG)' when the file has
 *   more than one frame, otherwise null.
 */
export async function animatedImageKind(file) {
  const head = new Uint8Array(await file.slice(0, 30).arrayBuffer());
  const sig = ascii(head, 0, 6);
  if (sig === 'GIF87a' || sig === 'GIF89a') {
    return (await gifFrameCount(file)) > 1 ? 'GIF' : null;
  }
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') {
    // Only an extended (VP8X) WebP can animate, and its flags byte says so.
    return ascii(head, 12, 4) === 'VP8X' && (head[20] & 0x02) ? 'WebP' : null;
  }
  if (head[0] === 0x89 && ascii(head, 1, 3) === 'PNG') {
    return (await pngAnimationFrameCount(file)) > 1 ? 'PNG (APNG)' : null;
  }
  return null;
}
