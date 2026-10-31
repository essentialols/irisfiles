/**
 * IrisFiles - landing-page integration for the high-value tool expansion.
 *
 * Kept separate from smart-drop.js so the mature inline-conversion dispatcher
 * does not need to learn about task routes that intentionally navigate to a
 * dedicated page (video -> audio, PDF editing, OCR, background removal, HTML -> PDF).
 */

import { storePendingFiles } from './pending-store.js';

const IMAGE_TOOLS = [
  ['Remove Background', '/background-remover'],
  ['Extract Text (OCR)', '/image-to-text'],
];

const JPG_ROUTE = { tools: IMAGE_TOOLS };

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
  jpg: JPG_ROUTE,
  jpeg: JPG_ROUTE,
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

function extensionOf(file) {
  const match = (file?.name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
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
        await storePendingFiles(files, href);
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
    // Smart Drop publishes the magic-byte format when the whole batch shares one,
    // so an extensionless or misnamed file still routes as what it is. Formats it
    // cannot sniff (HTML) fall back to requiring one shared file extension.
    const detectedExt = routePanel.dataset.detectedExt;
    const route = detectedExt
      ? SMART_ROUTES[detectedExt]
      : SMART_ROUTES[extensionOf(lastFiles[0])];
    if (!route || (!detectedExt && lastFiles.some(f => SMART_ROUTES[extensionOf(f)] !== route))) return;
    addRouteButtons(routePanel, lastFiles, 'Convert to', route.conversions);
    addRouteButtons(routePanel, lastFiles, 'Tools', route.tools);
  };

  const observer = new MutationObserver(apply);
  observer.observe(routePanel, { childList: true, subtree: true });
}

export function enhanceLanding() {
  // The tool rows for these pages live in index.html itself (merged into the
  // matching groups) so they are crawlable and never render as duplicate
  // "Image Tools" / "Documents" headings.
  enhanceSmartDrop();
}
