/** IrisFiles - Video to audio batch UI. */
import { convertVideoToAudio } from './media-audio-engine.js';
import { formatSize, downloadBlob, downloadAsZip, outputFilename, validateFile, MAX_BATCH_SIZE } from './converter.js';
import { loadPendingFiles } from './smart-drop.js';
import { checkWorkload } from './device-tier.js';
import { showPersistentNotice } from './notice-ui.js';

const queue = [];
let active = 0;
const CONCURRENCY = 2;
let targetFormat = 'mp3';
let targetExt = 'mp3';
let dropZone, fileInput, fileList, downloadAllBtn, clearAllBtn;

export function init() {
  const config = document.getElementById('converter-config');
  if (config) {
    targetFormat = config.dataset.targetFormat || 'mp3';
    targetExt = config.dataset.targetExt || targetFormat;
  }
  dropZone = document.getElementById('drop-zone');
  fileInput = document.getElementById('file-input');
  fileList = document.getElementById('file-list');
  downloadAllBtn = document.getElementById('download-all');
  clearAllBtn = document.getElementById('clear-all');
  if (!dropZone || !fileInput || !fileList) return;

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('dragover'); addFiles(e.dataTransfer.files); });
  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
  downloadAllBtn?.addEventListener('click', downloadAll);
  clearAllBtn?.addEventListener('click', clearAll);

  document.querySelectorAll('.faq-question').forEach(btn => btn.addEventListener('click', () => btn.parentElement.classList.toggle('open')));
  loadPendingFiles().then(files => { if (files?.length) addFiles(files); }).catch(() => {});
}

function addFiles(fileList_) {
  const room = MAX_BATCH_SIZE - queue.length;
  const items = Array.from(fileList_).slice(0, Math.max(0, room));
  if (!items.length && fileList_.length) return showNotice(`Batch limit reached (${MAX_BATCH_SIZE} files).`);
  const largest = items.reduce((m, f) => Math.max(m, f.size), 0);
  const warn = checkWorkload({ fileSizeMb: largest / 1e6, batchSize: items.length });
  if (warn) showNotice(warn);

  for (const file of items) {
    const entry = { id: crypto.randomUUID(), file, status: 'queued', progress: 0, outputBlob: null, outputName: outputFilename(file.name, targetExt), durationMs: null };
    try { validateFile(file); } catch (err) { entry.status = 'error'; entry.errorMsg = err.message; }
    queue.push(entry);
    render(entry);
  }
  updateBatch();
  processQueue();
}

async function processQueue() {
  while (active < CONCURRENCY) {
    const entry = queue.find(x => x.status === 'queued');
    if (!entry) break;
    active += 1;
    entry.status = 'processing';
    update(entry);
    const started = performance.now();
    try {
      entry.outputBlob = await convertVideoToAudio(entry.file, targetFormat, pct => { entry.progress = pct; update(entry); });
      entry.status = 'done'; entry.progress = 100; entry.durationMs = Math.round(performance.now() - started);
    } catch (err) {
      entry.status = 'error'; entry.errorMsg = err.message || 'Conversion failed.';
    }
    active -= 1;
    update(entry);
    updateBatch();
  }
  if (queue.some(x => x.status === 'queued')) setTimeout(processQueue, 0);
}

function render(entry) {
  const el = document.createElement('div');
  el.className = 'file-item';
  el.id = `file-${entry.id}`;
  el.innerHTML = `<div class="file-item__info"><div class="file-item__name">${esc(entry.file.name)}</div><div class="file-item__meta">${formatSize(entry.file.size)}</div></div><div class="file-item__progress"><div class="file-item__progress-bar" style="width:0%"></div></div><div class="file-item__actions"><span class="file-item__status">Queued</span></div>`;
  fileList.appendChild(el);
  update(entry);
}

function update(entry) {
  const el = document.getElementById(`file-${entry.id}`); if (!el) return;
  const bar = el.querySelector('.file-item__progress-bar');
  const actions = el.querySelector('.file-item__actions');
  const meta = el.querySelector('.file-item__meta');
  bar.style.width = `${entry.status === 'error' ? 100 : entry.progress}%`;
  bar.className = `file-item__progress-bar${entry.status === 'done' ? ' done' : ''}${entry.status === 'error' ? ' error' : ''}`;
  el.className = `file-item${entry.status === 'done' ? ' done' : ''}`;
  if (entry.status === 'processing') actions.innerHTML = '<span class="file-item__status">Extracting audio...</span>';
  if (entry.status === 'done') {
    const dur = entry.durationMs < 1000 ? `${entry.durationMs}ms` : `${(entry.durationMs / 1000).toFixed(1)}s`;
    meta.textContent = `${formatSize(entry.file.size)} → ${formatSize(entry.outputBlob.size)} · ${dur}`;
    actions.innerHTML = '<button class="btn btn--success btn-download" style="padding:.4rem .8rem;font-size:.8rem">Download</button><button class="btn btn--danger btn-remove">Remove</button>';
    actions.querySelector('.btn-download').onclick = () => downloadBlob(entry.outputBlob, entry.outputName);
    actions.querySelector('.btn-remove').onclick = () => remove(entry.id);
  }
  if (entry.status === 'error') {
    actions.innerHTML = `<span class="file-item__status error">${esc(entry.errorMsg || 'Error')}</span><button class="btn btn--danger btn-remove">Remove</button>`;
    actions.querySelector('.btn-remove').onclick = () => remove(entry.id);
  }
}

function remove(id) {
  const i = queue.findIndex(x => x.id === id); if (i >= 0) queue.splice(i, 1);
  document.getElementById(`file-${id}`)?.remove(); updateBatch();
}
function clearAll() { queue.length = 0; fileList.innerHTML = ''; updateBatch(); }
function updateBatch() {
  const done = queue.filter(x => x.status === 'done');
  if (downloadAllBtn) downloadAllBtn.style.display = done.length >= 2 ? '' : 'none';
  if (clearAllBtn) clearAllBtn.style.display = queue.length ? '' : 'none';
}
async function downloadAll() {
  const done = queue.filter(x => x.status === 'done' && x.outputBlob); if (done.length < 2) return;
  downloadAllBtn.disabled = true; downloadAllBtn.textContent = 'Zipping...';
  const entries = await Promise.all(done.map(async x => ({ name: x.outputName, data: new Uint8Array(await x.outputBlob.arrayBuffer()) })));
  await downloadAsZip(entries, `irisfiles-video-to-${targetExt}.zip`);
  downloadAllBtn.disabled = false; downloadAllBtn.textContent = 'Download All as ZIP';
}
function showNotice(msg) { showPersistentNotice(dropZone, msg, { id: 'media-audio-notice', kind: 'warning' }); }
function esc(value) { const d = document.createElement('div'); d.textContent = value; return d.innerHTML; }
