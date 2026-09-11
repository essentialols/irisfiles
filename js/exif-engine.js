/**
 * IrisFiles - Image metadata read/write engine
 * Uses ExifReader (read all formats) + piexifjs (lossless JPEG write).
 * Non-JPEG: read-only display + strip via Canvas re-encode fallback.
 */

import { stripMetadata } from './strip-engine.js';

const EXIFREADER_CDN = 'https://cdn.jsdelivr.net/npm/exifreader@4.23.5/dist/exif-reader.js';
const PIEXIFJS_CDN = 'https://cdn.jsdelivr.net/npm/piexifjs@1.0.6/piexif.js';

let exifReaderReady = null;
let piexifReady = null;

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${url}"]`);
    if (existing) { resolve(); return; }
    const s = document.createElement('script');
    s.src = url;
    s.onload = resolve;
    s.onerror = () => {
      s.remove();
      reject(new Error('Failed to load ' + url));
    };
    document.head.appendChild(s);
  });
}

function ensureExifReader() {
  if (exifReaderReady) return exifReaderReady;
  exifReaderReady = loadScript(EXIFREADER_CDN).catch(err => {
    exifReaderReady = null;
    throw err;
  });
  return exifReaderReady;
}

function ensurePiexif() {
  if (piexifReady) return piexifReady;
  piexifReady = loadScript(PIEXIFJS_CDN).catch(err => {
    piexifReady = null;
    throw err;
  });
  return piexifReady;
}

/**
 * Check if file is JPEG via magic bytes.
 */
export async function isJpeg(file) {
  const buf = new Uint8Array(await file.slice(0, 3).arrayBuffer());
  return buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
}

/**
 * Convert GPS DMS array from ExifReader to decimal degrees.
 * ExifReader returns GPS as array of rationals e.g. [40, 26, 46.302]
 */
function dmsToDecimal(dmsArr, ref) {
  if (!dmsArr || dmsArr.length < 3) return null;
  const d = typeof dmsArr[0] === 'object' ? dmsArr[0].value || dmsArr[0] : dmsArr[0];
  const m = typeof dmsArr[1] === 'object' ? dmsArr[1].value || dmsArr[1] : dmsArr[1];
  const s = typeof dmsArr[2] === 'object' ? dmsArr[2].value || dmsArr[2] : dmsArr[2];
  if (isNaN(d) || isNaN(m) || isNaN(s)) return null;
  let dec = Math.abs(d) + Math.abs(m) / 60 + Math.abs(s) / 3600;
  if (ref === 'S' || ref === 'W') dec = -dec;
  return Math.round(dec * 1000000) / 1000000;
}

function getTagValue(tag) {
  if (!tag) return null;
  if (tag.description !== undefined) return tag.description;
  if (tag.value !== undefined) return tag.value;
  return null;
}

/**
 * Read metadata from an image file using ExifReader.
 * Returns structured object grouped by category.
 */
export async function readMetadata(file) {
  await ensureExifReader();

  const buffer = await file.arrayBuffer();
  let tags;
  try {
    tags = ExifReader.load(buffer, { expanded: true });
  } catch (e) {
    // ExifReader throws on files with no metadata
    return { _empty: true, basic: {}, camera: {}, settings: {}, dates: {}, gps: {}, description: {} };
  }

  const exif = tags.exif || {};
  const gps = tags.gps || {};
  const file_ = tags.file || {};
  const xmp = tags.xmp || {};

  const result = {
    _empty: false,
    basic: {
      'Width': getTagValue(exif.ImageWidth || exif.PixelXDimension || file_['Image Width']),
      'Height': getTagValue(exif.ImageLength || exif.PixelYDimension || file_['Image Height']),
      'File Size': file.size,
      'Format': file.type || 'unknown',
      'Color Space': getTagValue(exif.ColorSpace),
      'Orientation': getTagValue(exif.Orientation),
    },
    camera: {
      'Make': getTagValue(exif.Make),
      'Model': getTagValue(exif.Model),
      'Lens Make': getTagValue(exif.LensMake),
      'Lens Model': getTagValue(exif.LensModel),
      'Software': getTagValue(exif.Software),
    },
    settings: {
      'ISO': getTagValue(exif.ISOSpeedRatings || exif.PhotographicSensitivity),
      'F-Number': getTagValue(exif.FNumber),
      'Exposure Time': getTagValue(exif.ExposureTime),
      'Focal Length': getTagValue(exif.FocalLength),
      'Flash': getTagValue(exif.Flash),
      'White Balance': getTagValue(exif.WhiteBalance),
    },
    dates: {
      'Date Taken': getTagValue(exif.DateTimeOriginal),
      'Date Digitized': getTagValue(exif.DateTimeDigitized),
      'Date Modified': getTagValue(exif.DateTime),
    },
    gps: {},
    description: {
      'Description': getTagValue(exif.ImageDescription || xmp.description),
      'User Comment': getTagValue(exif.UserComment),
      'Copyright': getTagValue(exif.Copyright),
      'Artist': getTagValue(exif.Artist),
    },
  };

  // GPS processing
  if (gps.Latitude !== undefined && gps.Longitude !== undefined) {
    result.gps['Latitude'] = typeof gps.Latitude === 'number' ? gps.Latitude : getTagValue(gps.Latitude);
    result.gps['Longitude'] = typeof gps.Longitude === 'number' ? gps.Longitude : getTagValue(gps.Longitude);
  } else if (exif.GPSLatitude) {
    const latVal = exif.GPSLatitude.value || exif.GPSLatitude;
    const lonVal = exif.GPSLongitude ? (exif.GPSLongitude.value || exif.GPSLongitude) : null;
    const latRef = getTagValue(exif.GPSLatitudeRef) || 'N';
    const lonRef = getTagValue(exif.GPSLongitudeRef) || 'E';
    if (Array.isArray(latVal)) {
      result.gps['Latitude'] = dmsToDecimal(latVal, latRef);
    }
    if (Array.isArray(lonVal)) {
      result.gps['Longitude'] = dmsToDecimal(lonVal, lonRef);
    }
  }
  if (gps.Altitude !== undefined) {
    result.gps['Altitude'] = typeof gps.Altitude === 'number'
      ? gps.Altitude + ' m'
      : getTagValue(gps.Altitude);
  } else if (exif.GPSAltitude) {
    result.gps['Altitude'] = getTagValue(exif.GPSAltitude);
  }

  // Check if all groups empty
  const hasData = Object.values(result).some(group => {
    if (typeof group !== 'object') return false;
    return Object.values(group).some(v => v !== null && v !== undefined);
  });
  result._empty = !hasData;

  return result;
}

// piexifjs field mapping (initialized lazily after piexif loads)
let FIELD_MAP = null;

function initFieldMap() {
  if (FIELD_MAP) return;
  const p = piexif;
  FIELD_MAP = {
    'Make':           { ifd: 'ImageIFD', tag: p.ImageIFD.Make },
    'Model':          { ifd: 'ImageIFD', tag: p.ImageIFD.Model },
    'Software':       { ifd: 'ImageIFD', tag: p.ImageIFD.Software },
    'Copyright':      { ifd: 'ImageIFD', tag: p.ImageIFD.Copyright },
    'Artist':         { ifd: 'ImageIFD', tag: p.ImageIFD.Artist },
    'Description':    { ifd: 'ImageIFD', tag: p.ImageIFD.ImageDescription },
    'Orientation':    { ifd: 'ImageIFD', tag: p.ImageIFD.Orientation },
    'Date Modified':  { ifd: 'ImageIFD', tag: p.ImageIFD.DateTime },
    'Date Taken':     { ifd: 'ExifIFD', tag: p.ExifIFD.DateTimeOriginal },
    'Date Digitized': { ifd: 'ExifIFD', tag: p.ExifIFD.DateTimeDigitized },
    'ISO':            { ifd: 'ExifIFD', tag: p.ExifIFD.ISOSpeedRatings },
    'User Comment':   { ifd: 'ExifIFD', tag: p.ExifIFD.UserComment },
  };
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function dataUrlToBlob(dataUrl) {
  const [header, b64] = dataUrl.split(',');
  if (b64 === undefined) throw new Error('Invalid image data');
  const match = header.match(/:(.*?);/);
  const mime = match ? match[1] : 'image/jpeg';
  let bin;
  try {
    bin = atob(b64);
  } catch {
    throw new Error('Invalid image data');
  }
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/**
 * Edit EXIF fields in a JPEG file losslessly using piexifjs.
 * @param {File} file - Source JPEG
 * @param {Object} changes - { fieldName: newValue } map
 * @returns {Promise<Blob>}
 */
export async function editExifFields(file, changes) {
  await ensurePiexif();
  initFieldMap();

  const dataUrl = await fileToDataUrl(file);
  let exifObj;
  try {
    exifObj = piexif.load(dataUrl);
  } catch {
    exifObj = { '0th': {}, 'Exif': {}, 'GPS': {}, '1st': {}, 'Interop': {} };
  }

  const IFD_KEY = { 'ImageIFD': '0th', 'ExifIFD': 'Exif', 'GPSIFD': 'GPS' };

  for (const [field, value] of Object.entries(changes)) {
    const mapping = FIELD_MAP[field];
    if (!mapping) continue;
    const ifdKey = IFD_KEY[mapping.ifd];
    if (!ifdKey) continue;
    if (value === '' || value === null) {
      delete exifObj[ifdKey][mapping.tag];
    } else {
      // piexifjs expects specific types; strings work for most text fields
      if (field === 'ISO') {
        exifObj[ifdKey][mapping.tag] = parseInt(value, 10) || 0;
      } else if (field === 'Orientation') {
        exifObj[ifdKey][mapping.tag] = parseInt(value, 10) || 1;
      } else {
        exifObj[ifdKey][mapping.tag] = String(value);
      }
    }
  }

  const exifBytes = piexif.dump(exifObj);
  const newDataUrl = piexif.insert(exifBytes, dataUrl);
  return dataUrlToBlob(newDataUrl);
}

/**
 * Strip metadata-bearing JPEG marker segments without touching compressed pixels.
 * Keep only the structural JFIF header (with any embedded thumbnail removed) and
 * Adobe APP14 color-transform marker; all other APP markers and comments can carry
 * EXIF, XMP, ICC, IPTC, vendor data, thumbnails, or other identifying metadata.
 */
function stripJpegMetadataBytes(input) {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) {
    throw new Error('Could not decode JPEG. The file may be corrupted or unsupported.');
  }

  const chunks = [input.slice(0, 2)];
  let pos = 2;
  let inScan = false;

  while (pos < input.length) {
    if (inScan) {
      const start = pos;
      while (pos < input.length) {
        if (input[pos] !== 0xff) { pos++; continue; }
        let markerPos = pos + 1;
        while (markerPos < input.length && input[markerPos] === 0xff) markerPos++;
        if (markerPos >= input.length) { pos = input.length; break; }
        const marker = input[markerPos];
        if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
          pos = markerPos + 1;
          continue;
        }
        break;
      }
      chunks.push(input.slice(start, pos));
      if (pos >= input.length) break;
      inScan = false;
    }

    const markerStart = pos;
    while (pos < input.length && input[pos] === 0xff) pos++;
    if (pos >= input.length) { chunks.push(input.slice(markerStart)); break; }
    const marker = input[pos++];

    // Standalone markers have no length field.
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7)) {
      chunks.push(input.slice(markerStart, pos));
      if (marker === 0xd9) break;
      continue;
    }

    if (pos + 2 > input.length) {
      throw new Error('Could not decode JPEG. The file may be corrupted or unsupported.');
    }
    const length = (input[pos] << 8) | input[pos + 1];
    if (length < 2 || pos + length > input.length) {
      throw new Error('Could not decode JPEG. The file may be corrupted or unsupported.');
    }
    const segmentEnd = pos + length;
    const payloadStart = pos + 2;

    const isApp = marker >= 0xe0 && marker <= 0xef;
    const isComment = marker === 0xfe;
    const isJfif = marker === 0xe0 && length >= 16 &&
      input[payloadStart] === 0x4a && input[payloadStart + 1] === 0x46 &&
      input[payloadStart + 2] === 0x49 && input[payloadStart + 3] === 0x46 &&
      input[payloadStart + 4] === 0x00;
    const isAdobeColor = marker === 0xee && length >= 14 &&
      input[payloadStart] === 0x41 && input[payloadStart + 1] === 0x64 &&
      input[payloadStart + 2] === 0x6f && input[payloadStart + 3] === 0x62 &&
      input[payloadStart + 4] === 0x65;

    if (isJfif) {
      // JFIF's optional RGB thumbnail is metadata too. Keep the 14-byte JFIF
      // descriptor for decoder compatibility, but explicitly remove its thumbnail.
      const clean = new Uint8Array(18);
      clean.set([0xff, 0xe0, 0x00, 0x10], 0);
      clean.set(input.slice(payloadStart, payloadStart + 14), 4);
      clean[16] = 0; // Xthumbnail
      clean[17] = 0; // Ythumbnail
      chunks.push(clean);
    } else if (!isApp && !isComment) {
      chunks.push(input.slice(markerStart, segmentEnd));
    } else if (isAdobeColor) {
      // APP14's transform flag affects how CMYK/YCCK JPEG pixels are interpreted.
      chunks.push(input.slice(markerStart, segmentEnd));
    }

    pos = segmentEnd;
    if (marker === 0xda) inScan = true;
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

/**
 * Strip all metadata from an image.
 * JPEG: remove metadata marker segments losslessly. Non-JPEG: Canvas re-encode.
 */
export async function stripAllMetadata(file) {
  if (await isJpeg(file)) {
    const clean = stripJpegMetadataBytes(new Uint8Array(await file.arrayBuffer()));
    return new Blob([clean], { type: 'image/jpeg' });
  }
  // Non-JPEG: delegate to Canvas re-encode
  return stripMetadata(file, () => {});
}

/**
 * Strip only GPS data from a JPEG, preserving all other EXIF. Lossless.
 */
export async function stripGpsOnly(file) {
  await ensurePiexif();
  const dataUrl = await fileToDataUrl(file);
  let exifObj;
  try {
    exifObj = piexif.load(dataUrl);
  } catch {
    return dataUrlToBlob(dataUrl);
  }
  exifObj['GPS'] = {};
  const exifBytes = piexif.dump(exifObj);
  const newDataUrl = piexif.insert(exifBytes, dataUrl);
  return dataUrlToBlob(newDataUrl);
}
