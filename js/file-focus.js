const ACTIVE_DB = 'irisfiles-active-file';
const ACTIVE_STORE = 'active';
const ACTIVE_KEY = 'current';
const CSS_HREF = '/css/file-focus.css';

const A = (label, href, kind = 'convert') => ({ label, href, kind });
const TOOL = (label, href) => A(label, href, 'tool');

const commonImageTools = [
  TOOL('Metadata', '/image-metadata'),
  TOOL('Compress', '/compress'),
  TOOL('Resize', '/resize-image'),
  TOOL('Strip EXIF', '/strip-exif'),
];
const makeGif = TOOL('Make GIF', '/images-to-gif');
const imageOcr = TOOL('Extract text', '/image-to-text');
const removeBackground = TOOL('Remove background', '/background-remover');
const createZip = TOOL('Create ZIP', '/create-zip');

function imageActions(conversions, extras = []) {
  return [...conversions, ...commonImageTools, ...extras];
}

function videoActions(src, targets) {
  return [
    ...targets.map(ext => A(ext.toUpperCase(), `/${src}-to-${ext}`)),
    A('GIF', `/${src}-to-gif`),
    A('MP3', `/${src}-to-mp3`),
    A('WAV', `/${src}-to-wav`),
    TOOL('Metadata', '/video-metadata'),
    TOOL('Compress', '/compress-video'),
    TOOL('Speed', '/video-speed'),
  ];
}

function audioActions(src, targets) {
  return [
    ...targets.map(ext => A(ext.toUpperCase(), `/${src}-to-${ext}`)),
    TOOL('Compress', '/compress-audio'),
  ];
}

// Keep this list aligned with the routes that actually accept each source type.
// Generic image tools come from Smart Drop's existing route matrix; specialized
// tools are only exposed for the formats their page/engine explicitly supports.
const ACTIONS_BY_EXT = {
  heic: imageActions([A('JPG','/heic-to-jpg'),A('PNG','/heic-to-png'),A('WebP','/heic-to-webp'),A('PDF','/heic-to-pdf')]),
  heif: imageActions([A('JPG','/heic-to-jpg'),A('PNG','/heic-to-png'),A('WebP','/heic-to-webp'),A('PDF','/heic-to-pdf')]),
  jpg: imageActions([A('PNG','/jpg-to-png'),A('WebP','/jpg-to-webp'),A('GIF','/jpg-to-gif'),A('PDF','/jpg-to-pdf')],[removeBackground,makeGif,imageOcr]),
  jpeg: imageActions([A('PNG','/jpg-to-png'),A('WebP','/jpg-to-webp'),A('GIF','/jpg-to-gif'),A('PDF','/jpg-to-pdf')],[removeBackground,makeGif,imageOcr]),
  png: imageActions([A('JPG','/png-to-jpg'),A('WebP','/png-to-webp'),A('GIF','/png-to-gif'),A('PDF','/png-to-pdf'),A('ICO','/png-to-ico')],[removeBackground,makeGif,imageOcr]),
  webp: imageActions([A('JPG','/webp-to-jpg'),A('PNG','/webp-to-png'),A('GIF','/webp-to-gif'),A('PDF','/webp-to-pdf')],[removeBackground,makeGif,imageOcr]),
  gif: imageActions([A('JPG','/gif-to-jpg'),A('PNG','/gif-to-png'),A('WebP','/gif-to-webp'),A('PDF','/gif-to-pdf'),A('MP4','/gif-to-mp4'),A('WebM','/gif-to-webm'),A('MOV','/gif-to-mov'),A('AVI','/gif-to-avi'),A('MKV','/gif-to-mkv')],[makeGif]),
  bmp: imageActions([A('JPG','/bmp-to-jpg'),A('PNG','/bmp-to-png'),A('WebP','/bmp-to-webp'),A('PDF','/bmp-to-pdf')],[removeBackground,makeGif,imageOcr]),
  avif: imageActions([A('JPG','/avif-to-jpg'),A('PNG','/avif-to-png'),A('WebP','/avif-to-webp'),A('PDF','/avif-to-pdf')],[makeGif]),
  tif: imageActions([A('JPG','/tiff-to-jpg'),A('PNG','/tiff-to-png'),A('WebP','/tiff-to-webp'),A('PDF','/tiff-to-pdf')]),
  tiff: imageActions([A('JPG','/tiff-to-jpg'),A('PNG','/tiff-to-png'),A('WebP','/tiff-to-webp'),A('PDF','/tiff-to-pdf')]),
  ico: imageActions([A('JPG','/ico-to-jpg'),A('PNG','/ico-to-png'),A('WebP','/ico-to-webp'),A('PDF','/ico-to-pdf')]),
  svg: imageActions([A('JPG','/svg-to-jpg'),A('PNG','/svg-to-png'),A('WebP','/svg-to-webp'),A('PDF','/svg-to-pdf')]),

  pdf: [
    A('JPG','/pdf-to-jpg'), A('PNG','/pdf-to-png'), A('Text','/pdf-to-text'),
    TOOL('OCR','/pdf-ocr'), TOOL('Compress','/compress-pdf'),
    TOOL('Split','/split-pdf'), TOOL('Merge','/merge-pdf'),
    TOOL('Rotate','/rotate-pdf'), TOOL('Reorder pages','/reorder-pdf-pages'),
    TOOL('Delete pages','/delete-pdf-pages'), TOOL('Extract pages','/extract-pdf-pages'),
  ],

  mp4: videoActions('mp4', ['webm','mov','avi','mkv']),
  webm: videoActions('webm', ['mp4','mov','avi','mkv']),
  mov: videoActions('mov', ['mp4','webm','avi','mkv']),
  avi: videoActions('avi', ['mp4','webm','mov','mkv']),
  mkv: videoActions('mkv', ['mp4','webm','mov','avi']),

  mp3: audioActions('mp3', ['wav','ogg','flac','m4a','aac']),
  wav: audioActions('wav', ['mp3','ogg','flac','m4a','aac']),
  ogg: audioActions('ogg', ['wav','mp3','flac','m4a','aac']),
  flac: audioActions('flac', ['wav','mp3','ogg','m4a','aac']),
  m4a: audioActions('m4a', ['wav','mp3','ogg','flac','aac']),
  aac: audioActions('aac', ['wav','mp3','ogg','flac','m4a']),

  epub: [A('TXT','/epub-to-txt'),A('PDF','/epub-to-pdf')],
  rtf: [A('TXT','/rtf-to-txt'),A('PDF','/rtf-to-pdf')],
  docx: [A('TXT','/docx-to-txt'),A('PDF','/docx-to-pdf')],
  mobi: [A('TXT','/mobi-to-txt'),A('PDF','/mobi-to-pdf')],
  prc: [A('TXT','/mobi-to-txt'),A('PDF','/mobi-to-pdf')],

  ttf: [A('OTF','/ttf-to-otf'),A('WOFF','/ttf-to-woff')],
  otf: [A('TTF','/otf-to-ttf'),A('WOFF','/otf-to-woff')],
  woff: [A('TTF','/woff-to-ttf'),A('OTF','/woff-to-otf')],

  zip: [TOOL('Extract files','/extract-zip')],
};

const MIME_EXT = {
  'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif',
  'image/bmp':'bmp','image/avif':'avif','image/heic':'heic','image/heif':'heif',
  'image/tiff':'tiff','image/x-icon':'ico','image/svg+xml':'svg',
  'application/pdf':'pdf','video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov',
  'video/x-msvideo':'avi','video/x-matroska':'mkv','audio/mpeg':'mp3',
  'audio/wav':'wav','audio/ogg':'ogg','audio/flac':'flac','audio/mp4':'m4a',
  'audio/aac':'aac','application/epub+zip':'epub','application/rtf':'rtf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx',
  'application/x-mobipocket-ebook':'mobi','font/ttf':'ttf','font/otf':'otf',
  'font/woff':'woff','application/zip':'zip',
};

function ensureStylesheet() {
  if (document.querySelector(`link[href="${CSS_HREF}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CSS_HREF;
  document.head.appendChild(link);
}

function extOf(file) {
  const name = file?.name || '';
  const dot = name.lastIndexOf('.');
  const fromName = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  return fromName || MIME_EXT[file?.type] || '';
}

function actionsFor(file) {
  const specific = ACTIONS_BY_EXT[extOf(file)] || [];
  return specific.some(action => action.href === createZip.href)
    ? specific
    : [...specific, createZip];
}

function normalizePath(path = location.pathname) {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed || '/';
}

function openActiveDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(ACTIVE_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(ACTIVE_STORE)) req.result.createObjectStore(ACTIVE_STORE);
    };
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
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ACTIVE_STORE, 'readwrite');
      tx.objectStore(ACTIVE_STORE).put(file, ACTIVE_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* best effort: persistence is an enhancement */ }
}

async function peekPendingFile() {
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('irisfiles', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('pending')) req.result.createObjectStore('pending');
      };
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function iconFor(ext) {
  if (['jpg','jpeg','png','webp','gif','bmp','avif','tif','tiff','ico','svg','heic','heif'].includes(ext)) return '▧';
  if (['mp4','webm','mov','avi','mkv'].includes(ext)) return '▶';
  if (['mp3','wav','ogg','flac','m4a','aac'].includes(ext)) return '♪';
  if (ext === 'pdf') return 'PDF';
  if (['ttf','otf','woff'].includes(ext)) return 'Aa';
  if (ext === 'zip') return 'ZIP';
  return 'FILE';
}

function renderGroup(title, actions, path) {
  if (!actions.length) return '';
  const links = actions.map(action => {
    const active = path === normalizePath(action.href);
    return `<a class="file-focus__action${active ? ' is-current' : ''}" href="${action.href}" data-file-focus-route="${action.href}"${active ? ' aria-current="page"' : ''}>${escapeHtml(action.label)}</a>`;
  }).join('');
  return `<div class="file-focus__group"><span class="file-focus__group-label">${title}</span><div class="file-focus__actions">${links}</div></div>`;
}

function insertionAnchor(dropZone) {
  return dropZone || document.querySelector('#file-list') || document.querySelector('main .container') || document.querySelector('main');
}

function render(file, dropZone) {
  if (!file) return;
  const ext = extOf(file);
  const actions = actionsFor(file);
  const converts = actions.filter(a => a.kind === 'convert');
  const tools = actions.filter(a => a.kind === 'tool');
  const path = normalizePath();

  let panel = document.querySelector('#active-file-focus');
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'active-file-focus';
    panel.className = 'file-focus';
    panel.setAttribute('aria-label', 'Current file workspace');
    const anchor = insertionAnchor(dropZone);
    if (!anchor) return;
    anchor.insertAdjacentElement('beforebegin', panel);
  }

  const available = actions.length
    ? `${renderGroup('Convert to', converts, path)}${renderGroup('Tools', tools, path)}`
    : `<p class="file-focus__empty">This file stays selected. IrisFiles does not have another tool for this format yet.</p>`;

  panel.innerHTML = `
    <div class="file-focus__top">
      <div class="file-focus__identity">
        <div class="file-focus__icon" aria-hidden="true">${iconFor(ext)}</div>
        <div class="file-focus__file">
          <div class="file-focus__eyebrow">Current file</div>
          <div class="file-focus__name" title="${escapeHtml(file.name || '')}">${escapeHtml(file.name || 'Untitled file')}</div>
          <div class="file-focus__meta">${escapeHtml((ext || 'file').toUpperCase())}${file.size != null ? ` · ${prettySize(file.size)}` : ''}<span class="file-focus__kept"> · original stays active</span></div>
        </div>
      </div>
      <button type="button" id="active-file-change" class="file-focus__change">Choose another</button>
    </div>
    <div class="file-focus__workspace">${available}</div>
  `;

  panel.querySelector('#active-file-change')?.addEventListener('click', () => {
    const selector = panel.dataset.inputSelector || '#file-input';
    document.querySelector(selector)?.click();
  });

  document.documentElement.classList.add('has-active-file');
  dropZone?.classList.add('compact');
}

function pageAcceptsFile(file) {
  const path = normalizePath();
  return actionsFor(file).some(action => normalizePath(action.href) === path);
}

function fileAlreadyRendered(file, fileInput) {
  if (fileInput?.files?.length) return true;
  const expected = file?.name || '';
  if (!expected) return false;
  return Array.from(document.querySelectorAll('.file-item__name, .frame-item__name'))
    .some(node => node.textContent?.trim() === expected);
}

async function hydrateWhenNeeded(file, fileInput) {
  if (!file || !fileInput || !pageAcceptsFile(file) || typeof DataTransfer !== 'function') return false;

  // Converter pages may already be consuming Smart Drop's pending-file handoff.
  // Give that path a brief head start and do not inject the same file twice.
  for (let i = 0; i < 5; i++) {
    if (fileAlreadyRendered(file, fileInput)) return false;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  if (fileAlreadyRendered(file, fileInput)) return false;

  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  } catch {
    return false;
  }
}

export async function initPersistentFileFocus(options = {}) {
  ensureStylesheet();

  const fileInputSelector = options.fileInputSelector || '#file-input';
  const dropZoneSelector = options.dropZoneSelector || '#drop-zone';
  const fileInput = document.querySelector(fileInputSelector);
  const dropZone = document.querySelector(dropZoneSelector);
  if (!fileInput || document.documentElement.dataset.fileFocusReady === '1') return;
  document.documentElement.dataset.fileFocusReady = '1';

  let active = await getActiveFile();
  const pending = await peekPendingFile();
  if (pending) {
    active = pending;
    await setActiveFile(pending);
  }

  if (active) {
    render(active, dropZone);
    const panel = document.querySelector('#active-file-focus');
    if (panel) panel.dataset.inputSelector = fileInputSelector;
    hydrateWhenNeeded(active, fileInput).catch(() => {});
  }

  fileInput.addEventListener('change', async () => {
    const next = fileInput.files?.[0];
    if (!next) return;
    await setActiveFile(next);
    render(next, dropZone);
    const panel = document.querySelector('#active-file-focus');
    if (panel) panel.dataset.inputSelector = fileInputSelector;
  }, true);

  dropZone?.addEventListener('drop', async event => {
    const next = event.dataTransfer?.files?.[0];
    if (!next) return;
    await setActiveFile(next);
    render(next, dropZone);
    const panel = document.querySelector('#active-file-focus');
    if (panel) panel.dataset.inputSelector = fileInputSelector;
  }, true);
}

export { ACTIONS_BY_EXT, actionsFor };
