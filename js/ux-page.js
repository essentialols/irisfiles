import { initPersistentFileFocus } from './file-focus.js';
import { installFileThumbFallback } from './file-thumb-fallback.js';

// "Drop HEIC files here, or click to browse" is the drop zone's own wording for
// what it accepts, so the picker's accessible name is derived from it rather
// than hardcoded per page. Every converter phrases that paragraph the same way.
function pickerLabel(dropZone) {
  const hint = Array.from(dropZone.querySelectorAll('p'))
    .map(node => (node.textContent || '').trim())
    .find(text => /click to browse/i.test(text));
  const subject = hint ? (hint.match(/^Drop\s+(.+?)\s+here\b/i) || [])[1] : '';
  return subject ? `Choose ${subject}` : 'Choose files';
}

/**
 * Expose the page's single upload control to assistive tech and automation.
 *
 * The file input was `display: none`, which takes it out of the accessibility
 * tree entirely, so the only upload-looking thing left was this wrapper with
 * `role="button"` -- and the wrapper holds the <h1>, the tagline, the icon, the
 * instruction and the disclaimer. That gave a control whose subtree contains a
 * heading (invalid, and a confusing accessible name) while the real input had no
 * node to target at all: an agent driving /heic-to-jpg from an accessibility
 * snapshot got a ref for the wrapper, whose role-and-name matched several
 * elements, and could never upload anything.
 *
 * The input itself is now the control: visually hidden by CSS but present,
 * focusable and named, so there is exactly one upload target per page and the
 * hero heading sits outside it. The wrapper goes back to being a plain
 * container, keeping its mouse click-to-browse and drag-and-drop behaviour.
 */
export function exposeFilePicker(dropZoneSelector = '#drop-zone', fileInputSelector = '#file-input') {
  const dropZone = typeof dropZoneSelector === 'string'
    ? document.querySelector(dropZoneSelector)
    : dropZoneSelector;
  const fileInput = typeof fileInputSelector === 'string'
    ? document.querySelector(fileInputSelector)
    : fileInputSelector;
  if (!dropZone || !fileInput) return;

  dropZone.removeAttribute('role');
  dropZone.removeAttribute('aria-label');
  dropZone.removeAttribute('aria-controls');
  dropZone.removeAttribute('tabindex');
  if (!fileInput.hasAttribute('aria-label')) fileInput.setAttribute('aria-label', pickerLabel(dropZone));

  if (dropZone.dataset.filePickerReady === '1') return;
  dropZone.dataset.filePickerReady = '1';
  // Activating the input (Enter or Space, now that it is focusable) fires a
  // click that bubbles to the wrapper, whose handler would call .click() on the
  // input again and open a second picker. The wrapper only has to react to
  // clicks on the surrounding area.
  fileInput.addEventListener('click', event => event.stopPropagation());
}

function syncFaqItem(item, index) {
  const btn = item.querySelector('.faq-question');
  const answer = item.querySelector('.faq-answer');
  if (!btn || !answer) return;

  if (!answer.id) answer.id = `faq-answer-${index + 1}`;
  btn.setAttribute('aria-controls', answer.id);
  const isOpen = item.classList.contains('open');
  btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  answer.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
}

export function enhanceFaqSemantics(root = document) {
  const items = Array.from(root.querySelectorAll('.faq-item'));
  if (items.length === 0) return;

  items.forEach((item, index) => syncFaqItem(item, index));
  if (document.documentElement.dataset.faqA11yReady === '1') return;
  document.documentElement.dataset.faqA11yReady = '1';

  document.addEventListener('click', (event) => {
    const btn = event.target.closest('.faq-question');
    if (!btn) return;
    requestAnimationFrame(() => {
      document.querySelectorAll('.faq-item').forEach((item, index) => syncFaqItem(item, index));
    });
  }, true);
}

export function normalizeActionLabels(root = document) {
  root.querySelectorAll('button').forEach((btn) => {
    if (btn.dataset.labelNormalized === '1') return;
    const text = btn.textContent ? btn.textContent.trim() : '';
    if (text === 'Clear') btn.textContent = 'Clear All';
    btn.dataset.labelNormalized = '1';
  });
}

export function injectPreflightBadge(options = {}) {
  const dropZoneSelector = options.dropZoneSelector || '#drop-zone';
  const dropZone = document.querySelector(dropZoneSelector);
  if (!dropZone || !options.preflight) return;

  const preflight = typeof options.preflight === 'string'
    ? { text: options.preflight }
    : options.preflight;
  if (!preflight.text) return;

  const badgeId = preflight.id || 'preflight-badge';
  let badge = document.getElementById(badgeId);
  if (!badge) {
    badge = document.createElement('div');
    badge.id = badgeId;
    badge.className = 'preflight-badge';
    badge.setAttribute('role', 'status');
    badge.setAttribute('aria-live', 'polite');
    badge.setAttribute('aria-atomic', 'true');

    const text = document.createElement('span');
    text.className = 'preflight-badge__text';
    badge.appendChild(text);

    if (preflight.dismissible) {
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'preflight-badge__dismiss';
      dismiss.textContent = 'Dismiss';
      dismiss.setAttribute('aria-label', 'Dismiss preflight notice');
      dismiss.addEventListener('click', () => {
        badge.style.display = 'none';
      });
      badge.appendChild(dismiss);
    }
  }

  const textNode = badge.querySelector('.preflight-badge__text');
  if (textNode) textNode.textContent = preflight.text;
  badge.style.display = '';

  if (!badge.parentElement) {
    dropZone.insertAdjacentElement('afterend', badge);
  }
}

export function applyPageUX(options = {}) {
  const resolvedOptions = options;
  // Every page that renders a source thumbnail gets the fallback from here, so
  // a new boot module cannot ship a broken <img> by forgetting to opt in. It
  // lived in boot.js alone, which left /resize-image showing one for HEIC.
  installFileThumbFallback();
  exposeFilePicker(resolvedOptions.dropZoneSelector, resolvedOptions.fileInputSelector);
  enhanceFaqSemantics(document);
  normalizeActionLabels(document);
  injectPreflightBadge(resolvedOptions);
  initPersistentFileFocus(resolvedOptions).catch(() => {});
}
