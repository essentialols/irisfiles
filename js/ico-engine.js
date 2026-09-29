/** IrisFiles - Pure browser PNG to ICO writer. */
import { detectFormat, validateDimensions } from './converter.js';

const SIZES = [16, 32, 48, 64, 128, 256];

function canvasPng(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode icon image.')), 'image/png'));
}
function writeU16(view, offset, value) { view.setUint16(offset, value, true); }
function writeU32(view, offset, value) { view.setUint32(offset, value, true); }

async function pngAnimationFrameCount(file) {
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

export async function pngToIco(file, onProgress = () => {}) {
  const format = await detectFormat(file);
  if (format?.mime !== 'image/png') throw new Error('This tool accepts PNG files only.');
  if (await pngAnimationFrameCount(file) > 1) {
    throw new Error('Animated PNG (APNG) cannot be converted to ICO without discarding frames. Use a single-frame PNG instead.');
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    validateDimensions(bitmap.width, bitmap.height);
    const payloads = [];
    for (let i = 0; i < SIZES.length; i++) {
      const size = SIZES[i];
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, size, size);
      const scale = Math.min(size / bitmap.width, size / bitmap.height);
      const w = Math.max(1, Math.round(bitmap.width * scale)); const h = Math.max(1, Math.round(bitmap.height * scale));
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, Math.floor((size - w) / 2), Math.floor((size - h) / 2), w, h);
      payloads.push(new Uint8Array(await (await canvasPng(canvas)).arrayBuffer()));
      canvas.width = canvas.height = 1;
      onProgress(Math.round(((i + 1) / SIZES.length) * 75));
    }

    const headerSize = 6 + 16 * payloads.length;
    const total = headerSize + payloads.reduce((sum, p) => sum + p.length, 0);
    const output = new Uint8Array(total); const view = new DataView(output.buffer);
    writeU16(view, 0, 0); writeU16(view, 2, 1); writeU16(view, 4, payloads.length);
    let dataOffset = headerSize;
    payloads.forEach((payload, index) => {
      const size = SIZES[index]; const entry = 6 + index * 16;
      output[entry] = size === 256 ? 0 : size; output[entry + 1] = size === 256 ? 0 : size;
      output[entry + 2] = 0; output[entry + 3] = 0;
      writeU16(view, entry + 4, 1); writeU16(view, entry + 6, 32);
      writeU32(view, entry + 8, payload.length); writeU32(view, entry + 12, dataOffset);
      output.set(payload, dataOffset); dataOffset += payload.length;
    });
    onProgress(100);
    return new Blob([output], { type: 'image/x-icon' });
  } finally { bitmap.close(); }
}
