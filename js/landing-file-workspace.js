/**
 * IrisFiles - Landing-page active file composition.
 *
 * The landing page already has a rich Smart Drop workspace with previews,
 * metadata and inline conversions. The site-wide persistent file-focus module
 * is still useful for dedicated tool pages, but rendering both on the landing
 * page duplicates the same file and actions.
 *
 * This module lets Smart Drop own the visible landing workspace while reusing
 * file-focus's action matrix to fill any gaps (for example Create ZIP).
 */

import { actionsForSelection } from './file-focus.js';

function workspaceIsActive(routePanel) {
  return routePanel.style.display !== 'none'
    && (routePanel.childElementCount > 0 || routePanel.textContent.trim().length > 0);
}

function isDetecting(routePanel) {
  return !!routePanel.querySelector('.route-panel__detecting');
}

function sectionFor(routePanel, labelText) {
  const existing = Array.from(routePanel.querySelectorAll('.route-section')).find((section) => {
    const label = section.querySelector('.route-section-label');
    return label?.textContent?.trim() === labelText;
  });
  if (existing) return existing;

  const section = document.createElement('div');
  section.className = 'route-section';
  section.dataset.landingWorkspaceSection = '1';

  const label = document.createElement('div');
  label.className = 'route-section-label';
  label.textContent = labelText;
  section.appendChild(label);
  routePanel.appendChild(section);
  return section;
}

function openPendingDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('irisfiles', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('pending')) req.result.createObjectStore('pending');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storePendingFiles(files) {
  const selection = Array.from(files || []).filter(Boolean);
  if (!selection.length) return false;

  const db = await openPendingDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('pending', 'readwrite');
      const store = tx.objectStore('pending');
      store.clear();
      selection.forEach((file, index) => store.put(file, index));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Could not store selected files.'));
    });
    return true;
  } finally {
    db.close();
  }
}

function mergePersistentActions(routePanel, selection) {
  if (!selection.length) return;

  const existingHrefs = new Set(
    Array.from(routePanel.querySelectorAll('[data-href]'))
      .map((node) => node.dataset.href)
      .filter(Boolean),
  );

  for (const action of actionsForSelection(selection)) {
    if (!action?.href || existingHrefs.has(action.href)) continue;

    const groupLabel = action.kind === 'tool' ? 'Tools' : 'Convert to';
    const section = sectionFor(routePanel, groupLabel);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'route-option';
    button.dataset.href = action.href;
    button.dataset.landingWorkspaceAction = '1';
    button.textContent = action.label;
    button.addEventListener('click', async () => {
      const original = button.textContent;
      button.disabled = true;
      button.textContent = 'Loading...';
      try {
        await storePendingFiles(selection);
        window.location.href = action.href;
      } catch (error) {
        button.disabled = false;
        button.textContent = original;
        console.error('Could not carry the active file to another tool:', error);
      }
    });
    section.appendChild(button);
    existingHrefs.add(action.href);
  }
}

function ensureChooseAnother(routePanel, fileInput) {
  if (routePanel.querySelector('[data-landing-workspace-change]')) return;

  let controls = routePanel.querySelector('.route-clear-wrap');
  if (!controls) {
    controls = document.createElement('div');
    controls.className = 'route-clear-wrap';
    controls.dataset.landingWorkspaceControls = '1';
    const firstSection = routePanel.querySelector('.route-section');
    if (firstSection) firstSection.insertAdjacentElement('beforebegin', controls);
    else routePanel.appendChild(controls);
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--secondary route-clear-btn';
  button.dataset.landingWorkspaceChange = '1';
  button.textContent = 'Choose another';
  button.addEventListener('click', () => fileInput.click());
  controls.appendChild(button);
}

export function initLandingFileWorkspace() {
  const dropZone = document.getElementById('smart-drop');
  const fileInput = document.getElementById('smart-file-input');
  const routePanel = document.getElementById('route-panel');
  if (!dropZone || !fileInput || !routePanel) return;
  if (routePanel.dataset.landingWorkspaceReady === '1') return;
  routePanel.dataset.landingWorkspaceReady = '1';

  let activeSelection = Array.from(fileInput.files || []);
  let syncQueued = false;

  const remember = (files) => {
    const next = Array.from(files || []).filter(Boolean);
    if (next.length) activeSelection = next;
  };

  fileInput.addEventListener('change', () => remember(fileInput.files), true);
  dropZone.addEventListener('drop', (event) => remember(event.dataTransfer?.files), true);

  // The rich workspace replaces the large picker after selection, but still
  // accepts a dropped replacement file so hiding the picker does not cost drag/drop.
  routePanel.addEventListener('dragover', (event) => {
    if (!workspaceIsActive(routePanel)) return;
    event.preventDefault();
  });
  routePanel.addEventListener('drop', (event) => {
    if (!workspaceIsActive(routePanel)) return;
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (!files?.length) return;
    remember(files);
    try {
      fileInput.files = files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    } catch {
      fileInput.click();
    }
  });

  const sync = () => {
    syncQueued = false;
    const active = workspaceIsActive(routePanel);

    if (!active) {
      dropZone.style.removeProperty('display');
      dropZone.removeAttribute('aria-hidden');
      document.documentElement.classList.remove('has-active-file');
      activeSelection = [];
      return;
    }

    // Smart Drop is the richer source of truth on the landing page. Remove the
    // generic persistent bar if it appears for the same selection.
    document.querySelector('#active-file-focus')?.remove();
    dropZone.style.display = 'none';
    dropZone.setAttribute('aria-hidden', 'true');

    // Do not decorate the temporary "Detecting..." state because Smart Drop
    // replaces its contents once detection finishes.
    if (isDetecting(routePanel)) return;

    ensureChooseAnother(routePanel, fileInput);
    mergePersistentActions(routePanel, activeSelection);
  };

  const queueSync = () => {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(sync);
  };

  new MutationObserver(queueSync).observe(routePanel, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style'],
  });

  // file-focus is inserted immediately on input change. Observing the document
  // ensures it is removed before the browser paints once Smart Drop owns the UI.
  new MutationObserver((mutations) => {
    if (!workspaceIsActive(routePanel)) return;
    if (mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) =>
      node.nodeType === Node.ELEMENT_NODE
      && (node.id === 'active-file-focus' || node.querySelector?.('#active-file-focus'))))) {
      queueSync();
    }
  }).observe(document.body, { childList: true, subtree: true });

  queueSync();
}
