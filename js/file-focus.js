const ACTIVE_DB = 'irisfiles-active-file';
const ACTIVE_STORE = 'active';
const ACTIVE_KEY = 'current';
const CSS_HREF = '/css/file-focus.css';

const A = (label, href, kind = 'convert') => ({ label, href, kind });
const imageTools = (extra = []) => [
  ...extra,
  A('Metadata', '/image-metadata', 'tool'),
  A('Compress', '/compress', 'tool'),
  A('Resize', '/resize-image', 'tool'),
  A('Strip EXIF', '/strip-exif', 'tool'),
  A('Make GIF', '/images-to-gif', 'tool'),
  A('Extract text', '/image-to-text', 'tool'),
];
const bgTool = A('Remove background', '/background-remover', 'tool');

const ACTIONS_BY_EXT = {
  heic: [A('JPG','/heic-to-jpg'),A('PNG','/heic-to-png'),A('WebP','/heic-to-webp'),A('PDF','/heic-to-pdf'),...imageTools()],
  heif: [A('JPG','/heic-to-jpg'),A('PNG','/heic-to-png'),A('WebP','/heic-to-webp'),A('PDF','/heic-to-pdf'),...imageTools()],
  jpg: [A('PNG','/jpg-to-png'),A('WebP','/jpg-to-webp'),A('GIF','/jpg-to-gif'),A('PDF','/jpg-to-pdf'),...imageTools([bgTool])],
  jpeg: [A('PNG','/jpg-to-png'),A('WebP','/jpg-to-webp'),A('GIF','/jpg-to-gif'),A('PDF','/jpg-to-pdf'),...imageTools([bgTool])],
  png: [A('JPG','/png-to-jpg'),A('WebP','/png-to-webp'),A('GIF','/png-to-gif'),A('PDF','/png-to-pdf'),A('ICO','/png-to-ico'),...imageTools([bgTool])],
  webp: [A('JPG','/webp-to-jpg'),A('PNG','/webp-to-png'),A('GIF','/webp-to-gif'),A('PDF','/webp-to-pdf'),...imageTools([bgTool])],
  gif: [A('JPG','/gif-to-jpg'),A('PNG','/gif-to-png'),A('WebP','/gif-to-webp'),A('PDF','/gif-to-pdf'),A('MP4','/gif-to-mp4'),A('WebM','/gif-to-webm'),A('MOV','/gif-to-mov'),A('AVI','/gif-to-avi'),A('MKV','/gif-to-mkv'),...imageTools()],
  bmp: [A('JPG','/bmp-to-jpg'),A('PNG','/bmp-to-png'),A('WebP','/bmp-to-webp'),A('PDF','/bmp-to-pdf'),...imageTools([bgTool])],
  avif: [A('JPG','/avif-to-jpg'),A('PNG','/avif-to-png'),A('WebP','/avif-to-webp'),A('PDF','/avif-to-pdf'),...imageTools()],
  tif: [A('JPG','/tiff-to-jpg'),A('PNG','/tiff-to-png'),A('WebP','/tiff-to-webp'),A('PDF','/tiff-to-pdf'),...imageTools()],
  tiff: [A('JPG','/tiff-to-jpg'),A('PNG','/tiff-to-png'),A('WebP','/tiff-to-webp'),A('PDF','/tiff-to-pdf'),...imageTools()],
  ico: [A('JPG','/ico-to-jpg'),A('PNG','/ico-to-png'),A('WebP','/ico-to-webp'),A('PDF','/ico-to-pdf'),...imageTools()],
  svg: [A('JPG','/svg-to-jpg'),A('PNG','/svg-to-png'),A('WebP','/svg-to-webp'),A('PDF','/svg-to-pdf'),...imageTools()],
  pdf: [
    A('JPG','/pdf-to-jpg'),A('PNG','/pdf-to-png'),A('Text','/pdf-to-text'),
    A('OCR','/pdf-ocr','tool'),A('Compress','/compress-pdf','tool'),
    A('Split','/split-pdf','tool'),A('Merge','/merge-pdf','tool'),
    A('Rotate','/rotate-pdf','tool'),A('Reorder pages','/reorder-pdf-pages','tool'),
    A('Delete pages','/delete-pdf-pages','tool'),A('Extract pages','/extract-pdf-pages','tool'),
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
  zip: [A('Extract files','/extract-zip','tool')],
};

function videoActions(src, targets) {
  return [
    ...targets.map(ext => A(ext.toUpperCase(), `/${src}-to-${ext}`)),
    A('GIF', `/${src}-to-gif`),
    A('MP3', `/${src}-to-mp3`),
    A('WAV', `/${src}-to-wav`),
    A('Metadata','/video-metadata','tool'),
    A('Compress','/compress-video','tool'),
    A('Speed','/video-speed','tool'),
  ];
}

function audioActions(src, targets) {
  return [
    ...targets.map(ext => A(ext.toUpperCase(), `/${src}-to-${ext}`)),
    A('Compress','/compress-audio','tool'),
  ];
}

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
  return ACTIONS_BY_EXT[extOf(file)] || [];
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
  } catch { /* best effort */ }
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

async function stageForNextPage(file) {
  if (!file) return;
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('irisfiles', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('pending')) req.result.createObjectStore('pending');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('pending', 'readwrite');
      const store = tx.objectStore('pending');
      store.clear();
      store.put(file, 0);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* current active store still survives */ }
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
          <div class="file-focus__name" title="${escapeHtml(file.name)}">${escapeHtml(file.name || 'Untitled file')}</div>
          <div class="file-focus__meta">${escapeHtml((ext || 'file').toUpperCase())}${file.size != null ? ` · ${prettySize(file.size)}` : ''}<span class="file-focus__kept"> · original stays active</span></div>
        </div>
      </div>
      <button type="button" id="active-file-change" class="file-focus__change">Choose another</button>
    </div>
    <div class="file-focus__workspace">${available}</div>
  `;

  panel.querySelector('#active-file-change')?.addEventListener('click', () => {
    document.querySelector('#file-input')?.click();
  });
  panel.querySelectorAll('[data-file-focus-route]').forEach(link => {
    link.addEventListener('click', () => { stageForNextPage(file); });
  });

  document.documentElement.classList.add('has-active-file');
  if (dropZone) dropZone.classList.add('compact');
}

function pageAcceptsFile(file) {
  const actions = actionsFor(file);
  const path = normalizePath();
  return actions.some(action => normalizePath(action.href) === path);
}

function hydrateInput(file, fileInput) {
  if (!file || !fileInput || fileInput.files?.length || !pageAcceptsFile(file)) return false;
  if (typeof DataTransfer !== 'function') return false;
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

  const fileInput = document.querySelector(options.fileInputSelector || '#file-input');
  const dropZone = document.querySelector(options.dropZoneSelector || '#drop-zone');
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
    queueMicrotask(() => hydrateInput(active, fileInput));
  }

  fileInput.addEventListener('change', async () => {
    const next = fileInput.files?.[0];
    if (!next) return;
    await setActiveFile(next);
    render(next, dropZone);
  }, true);

  dropZone?.addEventListener('drop', async event => {
    const next = event.dataTransfer?.files?.[0];
    if (!next) return;
    await setActiveFile(next);
    render(next, dropZone);
  }, true);
}

export { ACTIONS_BY_EXT, actionsFor };
