/**
 * IrisFiles - landing-page integration for the high-value tool expansion.
 *
 * Kept separate from smart-drop.js so the mature inline-conversion dispatcher
 * does not need to learn about task routes that intentionally navigate to a
 * dedicated page (video -> audio, PDF editing, OCR, background removal, HTML -> PDF).
 */

const LANDING_GROUPS = [
  {
    label: 'Video → Audio',
    rows: [
      ['MP4', [['MP3', '/mp4-to-mp3'], ['WAV', '/mp4-to-wav']]],
      ['MOV', [['MP3', '/mov-to-mp3'], ['WAV', '/mov-to-wav']]],
      ['WebM', [['MP3', '/webm-to-mp3'], ['WAV', '/webm-to-wav']]],
      ['AVI', [['MP3', '/avi-to-mp3'], ['WAV', '/avi-to-wav']]],
      ['MKV', [['MP3', '/mkv-to-mp3'], ['WAV', '/mkv-to-wav']]],
    ],
  },
  {
    label: 'Image Tools',
    rows: [
      ['Image', [['Background Remover', '/background-remover'], ['Text (OCR)', '/image-to-text']]],
      ['PNG', [['ICO', '/png-to-ico']]],
    ],
  },
  {
    label: 'PDF Tools',
    rows: [
      ['PDF', [
        ['Compress', '/compress-pdf'],
        ['Rotate', '/rotate-pdf'],
        ['Delete Pages', '/delete-pdf-pages'],
        ['Extract Pages', '/extract-pdf-pages'],
        ['Reorder', '/reorder-pdf-pages'],
        ['Text', '/pdf-to-text'],
      ]],
    ],
  },
  {
    label: 'Documents',
    rows: [
      ['HTML', [['PDF', '/html-to-pdf']]],
    ],
  },
];

const IMAGE_TOOLS = [
  ['Remove Background', '/background-remover'],
  ['Extract Text (OCR)', '/image-to-text'],
];

const SMART_ROUTES = {
  mp4: { conversions: [['MP3', '/mp4-to-mp3'], ['WAV', '/mp4-to-wav']] },
  mov: { conversions: [['MP3', '/mov-to-mp3'], ['WAV', '/mov-to-wav']] },
  webm: { conversions: [['MP3', '/webm-to-mp3'], ['WAV', '/webm-to-wav']] },
  avi: { conversions: [['MP3', '/avi-to-mp3'], ['WAV', '/avi-to-wav']] },
  mkv: { conversions: [['MP3', '/mkv-to-mp3'], ['WAV', '/mkv-to-wav']] },
  png: {
    conversions: [['ICO', '/png-to-ico']],
    tools: IMAGE_TOOLS,
  },
  jpg: { tools: IMAGE_TOOLS },
  jpeg: { tools: IMAGE_TOOLS },
  webp: { tools: IMAGE_TOOLS },
  bmp: { tools: IMAGE_TOOLS },
  pdf: {
    tools: [
      ['Compress PDF', '/compress-pdf'],
      ['Rotate Pages', '/rotate-pdf'],
      ['Delete Pages', '/delete-pdf-pages'],
      ['Extract Pages', '/extract-pdf-pages'],
      ['Reorder Pages', '/reorder-pdf-pages'],
      ['Extract Embedded Text', '/pdf-to-text'],
    ],
  },
  html: { conversions: [['PDF', '/html-to-pdf']] },
  htm: { conversions: [['PDF', '/html-to-pdf']] },
};

function appendLandingRows() {
  const table = document.querySelector('.convert-table');
  if (!table || table.dataset.highValueTools === '1') return;
  table.dataset.highValueTools = '1';

  for (const group of LANDING_GROUPS) {
    const heading = document.createElement('div');
    heading.className = 'convert-group';
    heading.textContent = group.label;
    table.appendChild(heading);

    for (const [source, targets] of group.rows) {
      const row = document.createElement('div');
      row.className = 'convert-row';

      const sourceEl = document.createElement('span');
      sourceEl.className = 'convert-source';
      sourceEl.textContent = source;
      row.appendChild(sourceEl);

      const arrow = document.createElement('span');
      arrow.className = 'convert-arrow';
      arrow.textContent = '→';
      row.appendChild(arrow);

      const targetWrap = document.createElement('div');
      targetWrap.className = 'convert-targets';
      for (const [label, href] of targets) {
        const link = document.createElement('a');
        link.href = href;
        link.className = 'tool-link';
        link.textContent = label;
        targetWrap.appendChild(link);
      }
      row.appendChild(targetWrap);
      table.appendChild(row);
    }
  }
}

function extensionOf(file) {
  const match = (file?.name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

function openPendingDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('irisfiles', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('pending')) {
        req.result.createObjectStore('pending');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storePendingFiles(files) {
  if (!files.length) return;
  const db = await openPendingDb();
  const tx = db.transaction('pending', 'readwrite');
  const store = tx.objectStore('pending');
  store.clear();
  files.forEach((file, index) => store.put(file, index));
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Could not store dropped files.'));
  });
  db.close();
}

function getOrCreateSection(routePanel, labelText) {
  const sections = Array.from(routePanel.querySelectorAll('.route-section'));
  const existing = sections.find(section =>
    section.querySelector('.route-section-label')?.textContent === labelText);
  if (existing) return existing;

  const section = document.createElement('div');
  section.className = 'route-section';
  const label = document.createElement('div');
  label.className = 'route-section-label';
  label.textContent = labelText;
  section.appendChild(label);
  routePanel.appendChild(section);
  return section;
}

function addRouteButtons(routePanel, files, labelText, routes) {
  if (!routes?.length) return;
  const section = getOrCreateSection(routePanel, labelText);

  for (const [label, href] of routes) {
    if (routePanel.querySelector(`.route-option[data-href="${href}"]`)) continue;
    const btn = document.createElement('button');
    btn.className = 'route-option';
    btn.dataset.href = href;
    btn.dataset.highValueRoute = '1';
    btn.textContent = label;
    btn.addEventListener('click', async () => {
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Loading...';
      try {
        await storePendingFiles(files);
        window.location.href = href;
      } catch (error) {
        btn.disabled = false;
        btn.textContent = original;
        console.error('Could not hand off dropped file:', error);
      }
    });
    section.appendChild(btn);
  }
}

function enhanceSmartDrop() {
  const dropZone = document.getElementById('smart-drop');
  const fileInput = document.getElementById('smart-file-input');
  const routePanel = document.getElementById('route-panel');
  if (!dropZone || !fileInput || !routePanel) return;

  let lastFiles = [];
  const remember = files => { lastFiles = Array.from(files || []); };

  // Capture first because smart-drop's own change handler clears fileInput.value.
  fileInput.addEventListener('change', () => remember(fileInput.files), true);
  dropZone.addEventListener('drop', event => remember(event.dataTransfer?.files), true);

  const apply = () => {
    if (!lastFiles.length || routePanel.style.display === 'none') return;
    const route = SMART_ROUTES[extensionOf(lastFiles[0])];
    if (!route) return;
    addRouteButtons(routePanel, lastFiles, 'Convert to', route.conversions);
    addRouteButtons(routePanel, lastFiles, 'Tools', route.tools);
  };

  const observer = new MutationObserver(apply);
  observer.observe(routePanel, { childList: true, subtree: true });
}

export function enhanceLanding() {
  appendLandingRows();
  enhanceSmartDrop();
}
