/**
 * IrisFiles - Shared metadata panel module
 * Reusable metadata display/edit for both the dedicated metadata tool (exif-ui.js)
 * and inline "Details" panels on converter pages (ui.js).
 */

import { readMetadata, isJpeg, editExifFields } from './exif-engine.js';
import { formatSize, downloadBlob } from './converter.js';

export const GROUP_LABELS = {
  basic: 'Basic Info',
  camera: 'Camera',
  settings: 'Camera Settings',
  dates: 'Dates',
  gps: 'GPS Location',
  description: 'Description',
};

export const EDITABLE_FIELDS = new Set([
  'Make', 'Model', 'Software', 'Copyright', 'Artist', 'Description',
  'User Comment', 'Orientation', 'Date Modified', 'Date Taken', 'Date Digitized', 'ISO',
]);

export const READONLY_ALWAYS = new Set([
  'Width', 'Height', 'File Size', 'Format', 'Color Space',
  'F-Number', 'Exposure Time', 'Focal Length', 'Flash', 'White Balance',
  'Lens Make', 'Lens Model', 'Latitude', 'Longitude', 'Altitude',
]);

/**
 * Render grouped metadata rows into a container element.
 * @param {HTMLElement} container - Target element to populate
 * @param {Object} metadata - Structured metadata from readMetadata()
 * @param {boolean} isJpegFile - Whether the source file is JPEG (enables editing)
 * @param {Object} [options]
 * @param {function} [options.onStripGps] - Callback for GPS strip button clicks
 */
export function renderMetadataTable(container, metadata, isJpegFile, options = {}) {
  container.innerHTML = '';

  if (metadata._empty) {
    container.innerHTML = '<div class="meta-notice">No metadata found in this image.</div>';
    return;
  }

  for (const [groupKey, label] of Object.entries(GROUP_LABELS)) {
    const groupData = metadata[groupKey];
    if (!groupData || typeof groupData !== 'object') continue;

    const entries = Object.entries(groupData).filter(([, v]) => v !== null && v !== undefined);
    const emptyEditableEntries = [];
    if (isJpegFile) {
      for (const [field] of Object.entries(groupData)) {
        if (groupData[field] === null || groupData[field] === undefined) {
          if (EDITABLE_FIELDS.has(field)) {
            emptyEditableEntries.push([field, null]);
          }
        }
      }
    }

    const allEntries = [...entries, ...emptyEditableEntries];
    if (allEntries.length === 0) continue;

    const group = document.createElement('div');
    group.className = 'meta-group';

    const title = document.createElement('div');
    title.className = 'meta-group__title';
    title.textContent = label;
    group.appendChild(title);

    const table = document.createElement('div');
    table.className = 'meta-table';

    for (const [field, value] of allEntries) {
      const row = document.createElement('div');
      row.className = 'meta-row';

      const labelEl = document.createElement('div');
      labelEl.className = 'meta-label';
      labelEl.textContent = field;
      row.appendChild(labelEl);

      const valueEl = document.createElement('div');
      valueEl.className = 'meta-value';

      if (field === 'File Size') {
        valueEl.textContent = formatSize(value);
      } else if (groupKey === 'gps' && (field === 'Latitude' || field === 'Longitude')) {
        const span = document.createElement('span');
        span.textContent = value !== null ? String(value) : '(not set)';
        valueEl.appendChild(span);
        if (value !== null && isJpegFile && options.onStripGps) {
          const removeBtn = document.createElement('button');
          removeBtn.className = 'meta-gps-remove';
          removeBtn.textContent = 'Remove GPS';
          removeBtn.addEventListener('click', options.onStripGps);
          valueEl.appendChild(removeBtn);
        }
      } else if (isJpegFile && EDITABLE_FIELDS.has(field) && !READONLY_ALWAYS.has(field)) {
        const input = document.createElement('input');
        input.className = 'meta-input';
        input.type = 'text';
        input.value = value !== null ? String(value) : '';
        input.placeholder = '(not set)';
        input.dataset.field = field;
        input.dataset.original = value !== null ? String(value) : '';
        input.addEventListener('input', () => {
          if (input.value !== input.dataset.original) {
            input.classList.add('changed');
          } else {
            input.classList.remove('changed');
          }
        });
        valueEl.appendChild(input);
      } else {
        valueEl.textContent = value !== null ? String(value) : '(not set)';
      }

      row.appendChild(valueEl);
      table.appendChild(row);
    }

    group.appendChild(table);
    container.appendChild(group);
  }
}

/**
 * Collect edited field values from input elements inside the container.
 * @param {HTMLElement} container
 * @returns {Object} Map of { fieldName: newValue }
 */
export function collectChanges(container) {
  const changes = {};
  container.querySelectorAll('.meta-input.changed').forEach(input => {
    changes[input.dataset.field] = input.value;
  });
  return changes;
}

/**
 * Create a collapsible metadata panel for a file.
 * Lazy-loads ExifReader via readMetadata(). Returns { container, promise }.
 * @param {File} file - Image file to read metadata from
 * @param {Object} [options]
 * @param {boolean} [options.inline=false] - If true, uses inline panel styling
 * @returns {{ container: HTMLElement, promise: Promise<void> }}
 */
export function createMetadataPanel(file, options = {}) {
  const container = document.createElement('div');
  container.className = options.inline ? 'inline-meta-panel' : 'metadata-panel';

  const loading = document.createElement('div');
  loading.className = 'meta-notice';
  loading.textContent = 'Reading metadata...';
  container.appendChild(loading);

  const promise = (async () => {
    const jpegFile = await isJpeg(file);
    const metadata = await readMetadata(file);

    loading.remove();
    renderMetadataTable(container, metadata, jpegFile);

    // Format notice
    const notice = document.createElement('div');
    notice.className = 'meta-notice';
    if (jpegFile) {
      notice.textContent = 'Metadata is stripped during format conversion. To edit metadata, use the Image Metadata tool.';
    } else {
      notice.textContent = 'Metadata is read-only for this format. Metadata is stripped during format conversion.';
    }
    container.appendChild(notice);

    // Save button for JPEG files with editable fields
    if (jpegFile) {
      const saveRow = document.createElement('div');
      saveRow.style.cssText = 'display:flex;gap:0.5rem;margin-top:0.5rem';
      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn btn--primary';
      saveBtn.style.cssText = 'padding:0.4rem 0.8rem;font-size:0.8rem';
      saveBtn.textContent = 'Save edited copy';
      saveBtn.addEventListener('click', async () => {
        const changes = collectChanges(container);
        if (Object.keys(changes).length === 0) return;
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        try {
          const blob = await editExifFields(file, changes);
          const base = file.name.replace(/\.[^.]+$/, '');
          downloadBlob(blob, base + '-metadata.jpg');
        } catch (err) {
          console.error('Metadata save error:', err);
        }
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save edited copy';
      });
      saveRow.appendChild(saveBtn);
      container.appendChild(saveRow);
    }
  })();

  return { container, promise };
}
