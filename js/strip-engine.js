/**
 * IrisFiles - EXIF/metadata strip engine
 * Re-encodes images through Canvas, which naturally drops all EXIF/metadata.
 */

/**
 * Strip all metadata from an image by re-encoding through Canvas.
 * @param {File|Blob} file - Source image
 * @param {function} onProgress - Progress callback (0-100)
 * @returns {Promise<Blob>}
 */
export async function stripMetadata(file, onProgress) {
  if (onProgress) onProgress(10);

  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (isGif(header)) {
    const data = new Uint8Array(await file.arrayBuffer());
    const stripped = stripGifMetadata(data);
    if (onProgress) onProgress(100);
    return new Blob([stripped], { type: 'image/gif' });
  }
  if (isWebp(header)) {
    const data = new Uint8Array(await file.arrayBuffer());
    const stripped = stripWebpMetadata(data);
    if (onProgress) onProgress(100);
    return new Blob([stripped], { type: 'image/webp' });
  }

  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Could not decode image. The file may be corrupted or in an unsupported format.');
  }

  if (onProgress) onProgress(30);

  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  // Determine output format: keep PNG as PNG, everything else as JPEG
  const isPng = file.type === 'image/png' ||
    (file.name && file.name.toLowerCase().endsWith('.png'));
  const mime = isPng ? 'image/png' : 'image/jpeg';

  if (mime === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.drawImage(bmp, 0, 0);
  bmp.close();

  if (onProgress) onProgress(70);

  // Use max quality to preserve visual fidelity
  const quality = isPng ? undefined : 1.0;
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      b => b ? resolve(b) : reject(new Error('Canvas toBlob failed')),
      mime,
      quality
    );
  });

  canvas.width = 1;
  canvas.height = 1;

  if (onProgress) onProgress(100);
  return blob;
}

function isGif(bytes) {
  if (bytes.length < 6) return false;
  const sig = ascii(bytes, 0, 6);
  return sig === 'GIF87a' || sig === 'GIF89a';
}

function isWebp(bytes) {
  return bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP';
}

function stripGifMetadata(data) {
  if (!isGif(data) || data.length < 13) throw invalidImage();

  const chunks = [];
  const packed = data[10];
  const globalTableBytes = (packed & 0x80) ? 3 * (1 << ((packed & 0x07) + 1)) : 0;
  let pos = 13 + globalTableBytes;
  if (pos > data.length) throw invalidImage();
  chunks.push(data.slice(0, pos));

  while (pos < data.length) {
    const start = pos;
    const marker = data[pos];

    if (marker === 0x3b) {
      chunks.push(data.slice(pos));
      pos = data.length;
      break;
    }

    if (marker === 0x2c) {
      if (pos + 10 > data.length) throw invalidImage();
      const localPacked = data[pos + 9];
      pos += 10;
      if (localPacked & 0x80) pos += 3 * (1 << ((localPacked & 0x07) + 1));
      if (pos >= data.length) throw invalidImage();
      pos += 1;
      pos = skipGifSubBlocks(data, pos);
      chunks.push(data.slice(start, pos));
      continue;
    }

    if (marker === 0x21) {
      if (pos + 2 > data.length) throw invalidImage();
      const label = data[pos + 1];
      pos += 2;
      if (pos >= data.length) throw invalidImage();

      let appId = '';
      if (label === 0xff) {
        const blockSize = data[pos];
        if (pos + 1 + blockSize > data.length) throw invalidImage();
        appId = ascii(data, pos + 1, blockSize);
      }
      pos = skipGifSubBlocks(data, pos);

      const remove = label === 0xfe ||
        (label === 0xff && (appId.startsWith('XMP DataXMP') || appId.startsWith('ICCRGBG1012')));
      if (!remove) chunks.push(data.slice(start, pos));
      continue;
    }

    throw invalidImage();
  }

  if (pos !== data.length) throw invalidImage();
  return concatBytes(chunks);
}

function skipGifSubBlocks(data, pos) {
  while (pos < data.length) {
    const size = data[pos++];
    if (size === 0) return pos;
    if (pos + size > data.length) throw invalidImage();
    pos += size;
  }
  throw invalidImage();
}

function stripWebpMetadata(data) {
  if (!isWebp(data)) throw invalidImage();
  const chunks = [];
  let pos = 12;

  while (pos + 8 <= data.length) {
    const start = pos;
    const type = ascii(data, pos, 4);
    const size = readU32LE(data, pos + 4);
    const dataEnd = pos + 8 + size;
    const paddedEnd = dataEnd + (size & 1);
    if (paddedEnd > data.length) throw invalidImage();

    if (type !== 'EXIF' && type !== 'XMP ' && type !== 'ICCP') {
      const chunk = data.slice(start, paddedEnd);
      if (type === 'VP8X' && size >= 1) {
        const copy = chunk.slice();
        copy[8] &= ~0x2c;
        chunks.push(copy);
      } else {
        chunks.push(chunk);
      }
    }
    pos = paddedEnd;
  }

  if (pos !== data.length) throw invalidImage();
  const total = 12 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  out.set(data.slice(0, 12), 0);
  writeU32LE(out, 4, total - 8);
  let offset = 12;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function readU32LE(data, offset) {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

function writeU32LE(data, offset, value) {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >>> 8) & 0xff;
  data[offset + 2] = (value >>> 16) & 0xff;
  data[offset + 3] = (value >>> 24) & 0xff;
}

function ascii(data, start, length) {
  let out = '';
  for (let i = 0; i < length && start + i < data.length; i++) out += String.fromCharCode(data[start + i]);
  return out;
}

function concatBytes(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function invalidImage() {
  return new Error('Could not decode image. The file may be corrupted or in an unsupported format.');
}
