const ACTIVE_DB = 'irisfiles-active-file';
const ACTIVE_STORE = 'active';
const ACTIVE_KEY = 'current';
const CSS_HREF = '/css/file-focus.css';

// The live selection lives in memory; it reaches disk only for a tool-to-tool hop.
let activeSelection = [];

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

function isBatchSafeAction(action) {
  const href = action?.href || '';
  if (['/create-zip','/compress','/resize-image','/strip-exif','/images-to-gif','/pdf-to-jpg','/pdf-to-png','/merge-pdf'].includes(href)) return true;
  if (/^\/(?:heic|jpg|png|webp|gif|bmp|avif|tiff|ico|svg)-to-(?:jpg|png|webp|gif|pdf|ico)$/.test(href)) return true;
  if (/^\/(?:mp3|wav|ogg|flac|m4a|aac)-to-(?:mp3|wav|ogg|flac|m4a|aac)$/.test(href)) return true;
  if (/^\/(?:ttf|otf|woff)-to-(?:ttf|otf|woff)$/.test(href)) return true;
  return false;
}

function actionsForSelection(files) {
  const selection = normalizeFiles(files);
  if (!selection.length) return [];
  const first = actionsFor(selection[0]);
  if (selection.length === 1) return first;
  const commonHrefs = selection.slice(1).map(file => new Set(actionsFor(file).map(action => action.href)));
  return first.filter(action => commonHrefs.every(hrefs => hrefs.has(action.href)) && isBatchSafeAction(action));
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

function normalizeFiles(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return [value];
}

// The handoff store is read once and emptied immediately, the same discipline
// smart-drop.js uses for its pending store. The carried files stay on disk only
// for the duration of a navigation, never after the tab is closed.
async function takeActiveFiles() {
  try {
    const db = await openActiveDb();
    const value = await reqResult(db.transaction(ACTIVE_STORE, 'readonly').objectStore(ACTIVE_STORE).get(ACTIVE_KEY));
    await clearActiveFiles();
    return normalizeFiles(value);
  } catch { return []; }
}

async function clearActiveFiles() {
  try {
    const db = await openActiveDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ACTIVE_STORE, 'readwrite');
      tx.objectStore(ACTIVE_STORE).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* best effort */ }
}

async function setActiveFiles(files) {
  const selection = Array.from(files || []).filter(Boolean);
  if (!selection.length) return;
  try {
    const db = await openActiveDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ACTIVE_STORE, 'readwrite');
      tx.objectStore(ACTIVE_STORE).put(selection, ACTIVE_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* best effort: persistence is an enhancement */ }
}

async function peekPendingFiles() {
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
    if (!keys.length) return [];
    const files = [];
    for (const key of keys) {
      const file = await reqResult(store.get(key));
      if (file) files.push(file);
    }
    return files;
  } catch { return []; }
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

function render(files, dropZone) {
  const selection = normalizeFiles(files);
  if (!selection.length) return;
  const file = selection[0];
  const ext = extOf(file);
  const extensions = [...new Set(selection.map(extOf).filter(Boolean))];
  const actions = actionsForSelection(selection);
  const converts = actions.filter(a => a.kind === 'convert');
  const tools = actions.filter(a => a.kind === 'tool');
  const path = normalizePath();
  const extraCount = selection.length - 1;
  const multiple = selection.length > 1;

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
    : `<p class="file-focus__empty">This selection stays active. IrisFiles does not have another shared tool for these formats yet.</p>`;
  const formatText = extensions.length === 1 ? extensions[0].toUpperCase() : 'Mixed formats';
  const countText = multiple ? ` · ${selection.length} files` : '';
  const keepText = multiple ? ' · originals stay active' : ' · original stays active';
  const fileTitle = selection.map(item => item.name || 'Untitled file').join('\n');

  panel.innerHTML = `
    <div class="file-focus__top">
      <div class="file-focus__identity">
        <div class="file-focus__icon" aria-hidden="true">${iconFor(ext)}</div>
        <div class="file-focus__file">
          <div class="file-focus__eyebrow">${multiple ? 'Current files' : 'Current file'}</div>
          <div class="file-focus__name" title="${escapeHtml(fileTitle)}">${escapeHtml(file.name || 'Untitled file')}${extraCount ? `<span class="file-focus__count">+${extraCount} more</span>` : ''}</div>
          <div class="file-focus__meta">${escapeHtml(formatText)}${countText}${file.size != null && !multiple ? ` · ${prettySize(file.size)}` : ''}<span class="file-focus__kept">${keepText}</span></div>
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

function pageAcceptsSelection(files) {
  const path = normalizePath();
  return actionsForSelection(files).some(action => normalizePath(action.href) === path);
}

function selectionAlreadyRendered(files, fileInput) {
  const selection = normalizeFiles(files);
  if (!selection.length) return false;
  const inputFiles = Array.from(fileInput?.files || []);
  if (inputFiles.length === selection.length && selection.every((file, index) => inputFiles[index]?.name === file.name)) return true;
  const rendered = new Set(Array.from(document.querySelectorAll('.file-item__name, .frame-item__name'))
    .map(node => node.textContent?.trim()).filter(Boolean));
  return selection.every(file => rendered.has(file.name));
}

async function hydrateWhenNeeded(files, fileInput) {
  const selection = normalizeFiles(files);
  if (!selection.length || !fileInput || !pageAcceptsSelection(selection) || typeof DataTransfer !== 'function') return false;

  // The caller's pageOwnsInjection check rules out the Smart Drop handoff, but
  // this still has to outlast the page's own boot: a converter that resets
  // fileInput.value while initializing would otherwise discard an early inject.
  for (let i = 0; i < 5; i++) {
    if (selectionAlreadyRendered(selection, fileInput)) return false;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  if (selectionAlreadyRendered(selection, fileInput)) return false;

  try {
    const dt = new DataTransfer();
    for (const file of selection) dt.items.add(file);
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

  let activeFiles = await takeActiveFiles();
  const pendingFiles = await peekPendingFiles();
  // Smart Drop's own pending handoff owns injection on this page, so file-focus
  // only renders the panel. Deciding this up front replaces the timing poll that
  // previously guessed whether the page had already inserted the same files.
  const pageOwnsInjection = pendingFiles.length > 0;
  if (pageOwnsInjection) activeFiles = pendingFiles;

  const setSelection = files => {
    activeSelection = files;
    render(files, dropZone);
    const panel = document.querySelector('#active-file-focus');
    if (panel) panel.dataset.inputSelector = fileInputSelector;
  };

  if (activeFiles.length) {
    setSelection(activeFiles);
    if (!pageOwnsInjection) hydrateWhenNeeded(activeFiles, fileInput).catch(() => {});
  }

  fileInput.addEventListener('change', () => {
    const next = Array.from(fileInput.files || []);
    if (next.length) setSelection(next);
  }, true);

  dropZone?.addEventListener('drop', event => {
    const next = Array.from(event.dataTransfer?.files || []);
    if (next.length) setSelection(next);
  }, true);

  // The files are written only here, when the user actually carries them to
  // another tool, and the destination empties the store as soon as it reads it.
  document.addEventListener('click', async event => {
    const link = event.target.closest?.('[data-file-focus-route]');
    if (!link || !activeSelection.length) return;
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      setActiveFiles(activeSelection);  // opening a new tab: cannot await, write best-effort
      return;
    }
    event.preventDefault();
    await setActiveFiles(activeSelection);
    location.href = link.getAttribute('href');
  });
}

export { ACTIONS_BY_EXT, actionsFor, actionsForSelection };
