const ACTIVE_DB = 'irisfiles-active-file';
const ACTIVE_STORE = 'active';
const ACTIVE_KEY = 'current';

const ROUTES_BY_EXT = {
  heic: [['JPG','/heic-to-jpg'],['PNG','/heic-to-png'],['WebP','/heic-to-webp'],['PDF','/heic-to-pdf'],['Metadata','/image-metadata'],['Compress','/compress'],['Resize','/resize-image'],['Strip EXIF','/strip-exif']],
  heif: [['JPG','/heic-to-jpg'],['PNG','/heic-to-png'],['WebP','/heic-to-webp'],['PDF','/heic-to-pdf'],['Metadata','/image-metadata'],['Compress','/compress'],['Resize','/resize-image'],['Strip EXIF','/strip-exif']],
  jpg: [['PNG','/jpg-to-png'],['WebP','/jpg-to-webp'],['GIF','/jpg-to-gif'],['PDF','/jpg-to-pdf'],['Metadata','/image-metadata'],['Compress','/compress'],['Resize','/resize-image'],['Strip EXIF','/strip-exif']],
  jpeg: [['PNG','/jpg-to-png'],['WebP','/jpg-to-webp'],['GIF','/jpg-to-gif'],['PDF','/jpg-to-pdf'],['Metadata','/image-metadata'],['Compress','/compress'],['Resize','/resize-image'],['Strip EXIF','/strip-exif']],
  png: [['JPG','/png-to-jpg'],['WebP','/png-to-webp'],['GIF','/png-to-gif'],['PDF','/png-to-pdf'],['Metadata','/image-metadata'],['Compress','/compress'],['Resize','/resize-image'],['Strip EXIF','/strip-exif']],
  webp: [['JPG','/webp-to-jpg'],['PNG','/webp-to-png'],['GIF','/webp-to-gif'],['PDF','/webp-to-pdf'],['Metadata','/image-metadata'],['Compress','/compress'],['Resize','/resize-image'],['Strip EXIF','/strip-exif']],
  gif: [['JPG','/gif-to-jpg'],['PNG','/gif-to-png'],['WebP','/gif-to-webp'],['PDF','/gif-to-pdf'],['MP4','/gif-to-mp4'],['WebM','/gif-to-webm'],['MOV','/gif-to-mov'],['AVI','/gif-to-avi'],['MKV','/gif-to-mkv']],
  bmp: [['JPG','/bmp-to-jpg'],['PNG','/bmp-to-png'],['WebP','/bmp-to-webp'],['PDF','/bmp-to-pdf'],['Metadata','/image-metadata'],['Compress','/compress'],['Resize','/resize-image']],
  avif: [['JPG','/avif-to-jpg'],['PNG','/avif-to-png'],['WebP','/avif-to-webp'],['PDF','/avif-to-pdf'],['Metadata','/image-metadata'],['Compress','/compress'],['Resize','/resize-image']],
  tif: [['JPG','/tiff-to-jpg'],['PNG','/tiff-to-png'],['WebP','/tiff-to-webp'],['PDF','/tiff-to-pdf'],['Metadata','/image-metadata'],['Compress','/compress'],['Resize','/resize-image']],
  tiff: [['JPG','/tiff-to-jpg'],['PNG','/tiff-to-png'],['WebP','/tiff-to-webp'],['PDF','/tiff-to-pdf'],['Metadata','/image-metadata'],['Compress','/compress'],['Resize','/resize-image']],
  ico: [['JPG','/ico-to-jpg'],['PNG','/ico-to-png'],['WebP','/ico-to-webp'],['PDF','/ico-to-pdf'],['Metadata','/image-metadata']],
  svg: [['JPG','/svg-to-jpg'],['PNG','/svg-to-png'],['WebP','/svg-to-webp'],['PDF','/svg-to-pdf'],['Metadata','/image-metadata']],
  pdf: [['JPG','/pdf-to-jpg'],['PNG','/pdf-to-png'],['Split','/split-pdf'],['Merge','/merge-pdf'],['OCR','/pdf-ocr']],
  mp4: [['WebM','/mp4-to-webm'],['MOV','/mp4-to-mov'],['AVI','/mp4-to-avi'],['MKV','/mp4-to-mkv'],['GIF','/mp4-to-gif'],['Metadata','/video-metadata'],['Compress','/compress-video'],['Speed','/video-speed']],
  webm: [['MP4','/webm-to-mp4'],['MOV','/webm-to-mov'],['AVI','/webm-to-avi'],['MKV','/webm-to-mkv'],['GIF','/webm-to-gif'],['Metadata','/video-metadata'],['Compress','/compress-video'],['Speed','/video-speed']],
  mov: [['MP4','/mov-to-mp4'],['WebM','/mov-to-webm'],['AVI','/mov-to-avi'],['MKV','/mov-to-mkv'],['GIF','/mov-to-gif'],['Metadata','/video-metadata'],['Compress','/compress-video'],['Speed','/video-speed']],
  avi: [['MP4','/avi-to-mp4'],['WebM','/avi-to-webm'],['MOV','/avi-to-mov'],['MKV','/avi-to-mkv'],['GIF','/avi-to-gif'],['Metadata','/video-metadata'],['Compress','/compress-video'],['Speed','/video-speed']],
  mkv: [['MP4','/mkv-to-mp4'],['WebM','/mkv-to-webm'],['MOV','/mkv-to-mov'],['AVI','/mkv-to-avi'],['GIF','/mkv-to-gif'],['Metadata','/video-metadata'],['Compress','/compress-video'],['Speed','/video-speed']],
  mp3: [['WAV','/mp3-to-wav'],['OGG','/mp3-to-ogg'],['FLAC','/mp3-to-flac'],['M4A','/mp3-to-m4a'],['AAC','/mp3-to-aac'],['Compress','/compress-audio']],
  wav: [['MP3','/wav-to-mp3'],['OGG','/wav-to-ogg'],['FLAC','/wav-to-flac'],['M4A','/wav-to-m4a'],['AAC','/wav-to-aac'],['Compress','/compress-audio']],
  ogg: [['WAV','/ogg-to-wav'],['MP3','/ogg-to-mp3'],['FLAC','/ogg-to-flac'],['M4A','/ogg-to-m4a'],['AAC','/ogg-to-aac'],['Compress','/compress-audio']],
  flac: [['WAV','/flac-to-wav'],['MP3','/flac-to-mp3'],['OGG','/flac-to-ogg'],['M4A','/flac-to-m4a'],['AAC','/flac-to-aac'],['Compress','/compress-audio']],
  m4a: [['WAV','/m4a-to-wav'],['MP3','/m4a-to-mp3'],['OGG','/m4a-to-ogg'],['FLAC','/m4a-to-flac'],['AAC','/m4a-to-aac'],['Compress','/compress-audio']],
  aac: [['WAV','/aac-to-wav'],['MP3','/aac-to-mp3'],['OGG','/aac-to-ogg'],['FLAC','/aac-to-flac'],['M4A','/aac-to-m4a'],['Compress','/compress-audio']],
  epub: [['TXT','/epub-to-txt'],['PDF','/epub-to-pdf']],
  rtf: [['TXT','/rtf-to-txt'],['PDF','/rtf-to-pdf']],
  docx: [['TXT','/docx-to-txt'],['PDF','/docx-to-pdf']],
  mobi: [['TXT','/mobi-to-txt'],['PDF','/mobi-to-pdf']],
  prc: [['TXT','/mobi-to-txt'],['PDF','/mobi-to-pdf']],
  ttf: [['OTF','/ttf-to-otf'],['WOFF','/ttf-to-woff']],
  otf: [['TTF','/otf-to-ttf'],['WOFF','/otf-to-woff']],
  woff: [['TTF','/woff-to-ttf'],['OTF','/woff-to-otf']],
  zip: [['Extract','/extract-zip']],
};

function extOf(file) {
  const name = file?.name || '';
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function openActiveDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(ACTIVE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(ACTIVE_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function reqResult(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getActiveFile() {
  try {
    const db = await openActiveDb();
    return await reqResult(db.transaction(ACTIVE_STORE, 'readonly').objectStore(ACTIVE_STORE).get(ACTIVE_KEY));
  } catch { return null; }
}

async function setActiveFile(file) {
  if (!file) return;
  try {
    const db = await openActiveDb();
    const tx = db.transaction(ACTIVE_STORE, 'readwrite');
    tx.objectStore(ACTIVE_STORE).put(file, ACTIVE_KEY);
  } catch { /* best effort */ }
}

async function peekPendingFile() {
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('irisfiles', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('pending');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const store = db.transaction('pending', 'readonly').objectStore('pending');
    const keys = await reqResult(store.getAllKeys());
    return keys.length ? await reqResult(store.get(keys[0])) : null;
  } catch { return null; }
}

function prettySize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function render(file) {
  const dropZone = document.querySelector('#drop-zone');
  if (!dropZone || !file) return;
  const routes = ROUTES_BY_EXT[extOf(file)] || [];
  if (!routes.length) return;

  let panel = document.querySelector('#active-file-focus');
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'active-file-focus';
    panel.setAttribute('aria-label', 'Active file');
    dropZone.insertAdjacentElement('beforebegin', panel);
  }

  const path = location.pathname.replace(/\/$/, '') || '/';
  const buttons = routes.map(([label, href]) => {
    const active = path === href;
    return `<a href="${href}" style="display:inline-flex;align-items:center;padding:.5rem .7rem;border:1px solid var(--border,#d9dde5);border-radius:.55rem;text-decoration:none;font-size:.82rem;${active ? 'font-weight:700;background:var(--surface-2,#f3f5f8);' : ''}"${active ? ' aria-current="page"' : ''}>${label}</a>`;
  }).join('');

  panel.innerHTML = `
    <div style="border:1px solid var(--border,#d9dde5);border-radius:.85rem;padding:.85rem 1rem;margin:0 0 1rem;background:var(--surface,#fff)">
      <div style="display:flex;gap:.75rem;align-items:center;justify-content:space-between;flex-wrap:wrap">
        <div style="min-width:0">
          <div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;opacity:.62;margin-bottom:.15rem">Working on</div>
          <div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:min(70vw,42rem)">${escapeHtml(file.name)}</div>
          <div style="font-size:.78rem;opacity:.64;margin-top:.1rem">${extOf(file).toUpperCase()} · ${prettySize(file.size)} · stays selected until you choose another file</div>
        </div>
        <button type="button" id="active-file-change" class="btn btn--secondary" style="white-space:nowrap">Choose another file</button>
      </div>
      <div style="font-size:.75rem;font-weight:600;margin-top:.8rem;margin-bottom:.4rem">Other things you can do with this file</div>
      <div style="display:flex;gap:.4rem;flex-wrap:wrap">${buttons}</div>
    </div>`;

  panel.querySelector('#active-file-change')?.addEventListener('click', () => document.querySelector('#file-input')?.click());
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

export async function initPersistentFileFocus(options = {}) {
  const fileInput = document.querySelector(options.fileInputSelector || '#file-input');
  const dropZone = document.querySelector(options.dropZoneSelector || '#drop-zone');
  if (!fileInput || !dropZone || document.documentElement.dataset.fileFocusReady === '1') return;
  document.documentElement.dataset.fileFocusReady = '1';

  let active = await getActiveFile();
  if (!active) {
    active = await peekPendingFile();
    if (active) await setActiveFile(active);
  }
  if (active) render(active);

  fileInput.addEventListener('change', async () => {
    const next = fileInput.files?.[0];
    if (!next) return;
    await setActiveFile(next);
    render(next);
  }, true);

  dropZone.addEventListener('drop', async event => {
    const next = event.dataTransfer?.files?.[0];
    if (!next) return;
    await setActiveFile(next);
    render(next);
  }, true);
}
