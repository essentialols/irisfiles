/** IrisFiles - PNG to ICO batch UI. */
import { pngToIco } from './ico-engine.js';
import { validateFile, formatSize, downloadBlob, downloadAsZip, outputFilename, MAX_BATCH_SIZE } from './converter.js';
import { loadPendingFiles } from './smart-drop.js';
import { showPersistentNotice } from './notice-ui.js';

const queue = []; let active = 0; const CONCURRENCY = 2;
let dropZone, fileInput, fileList, downloadAllBtn, clearAllBtn;
export function init() {
  dropZone = document.getElementById('drop-zone'); fileInput = document.getElementById('file-input'); fileList = document.getElementById('file-list');
  downloadAllBtn = document.getElementById('download-all'); clearAllBtn = document.getElementById('clear-all'); if (!dropZone || !fileInput) return;
  dropZone.addEventListener('click', () => fileInput.click()); dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover')); dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('dragover'); add(e.dataTransfer.files); });
  fileInput.addEventListener('change', () => { add(fileInput.files); fileInput.value = ''; }); downloadAllBtn?.addEventListener('click', downloadAll); clearAllBtn?.addEventListener('click', clear);
  document.querySelectorAll('.faq-question').forEach(btn => btn.addEventListener('click', () => btn.parentElement.classList.toggle('open')));
  loadPendingFiles().then(files => { if (files?.length) add(files); }).catch(() => {});
}
function add(files) {
  for (const file of Array.from(files).slice(0, MAX_BATCH_SIZE - queue.length)) {
    const entry = { id: crypto.randomUUID(), file, status: 'queued', progress: 0, output: null, name: outputFilename(file.name, 'ico') };
    try { validateFile(file); } catch (err) { entry.status = 'error'; entry.error = err.message; }
    queue.push(entry); render(entry);
  } updateBatch(); processQueue();
}
async function processQueue() {
  while (active < CONCURRENCY) {
    const entry = queue.find(x => x.status === 'queued'); if (!entry) break; active++; entry.status = 'processing'; update(entry);
    try { entry.output = await pngToIco(entry.file, p => { entry.progress = p; update(entry); }); entry.status = 'done'; entry.progress = 100; }
    catch (err) { entry.status = 'error'; entry.error = err.message; }
    active--; update(entry); updateBatch();
  } if (queue.some(x => x.status === 'queued')) setTimeout(processQueue, 0);
}
function render(entry) { const el = document.createElement('div'); el.id = `file-${entry.id}`; el.className = 'file-item'; el.innerHTML = `<div class="file-item__info"><div class="file-item__name">${esc(entry.file.name)}</div><div class="file-item__meta">${formatSize(entry.file.size)}</div></div><div class="file-item__progress"><div class="file-item__progress-bar"></div></div><div class="file-item__actions"><span class="file-item__status">Queued</span></div>`; fileList.appendChild(el); update(entry); }
function update(entry) { const el = document.getElementById(`file-${entry.id}`); if (!el) return; const bar = el.querySelector('.file-item__progress-bar'); const actions = el.querySelector('.file-item__actions'); bar.style.width = `${entry.status === 'error' ? 100 : entry.progress}%`; if (entry.status === 'processing') actions.innerHTML = '<span class="file-item__status">Building icon...</span>'; if (entry.status === 'done') { el.classList.add('done'); actions.innerHTML = '<button class="btn btn--success dl">Download</button><button class="btn btn--danger rm">Remove</button>'; actions.querySelector('.dl').onclick = () => downloadBlob(entry.output, entry.name); actions.querySelector('.rm').onclick = () => remove(entry.id); el.querySelector('.file-item__meta').textContent = `${formatSize(entry.file.size)} → ${formatSize(entry.output.size)}`; } if (entry.status === 'error') { actions.innerHTML = `<span class="file-item__status error">${esc(entry.error || 'Error')}</span><button class="btn btn--danger rm">Remove</button>`; actions.querySelector('.rm').onclick = () => remove(entry.id); } }
function remove(id) { const i = queue.findIndex(x => x.id === id); if (i >= 0) queue.splice(i, 1); document.getElementById(`file-${id}`)?.remove(); updateBatch(); }
function clear() { queue.length = 0; fileList.innerHTML = ''; updateBatch(); }
function updateBatch() { const done = queue.filter(x => x.status === 'done'); if (downloadAllBtn) downloadAllBtn.style.display = done.length >= 2 ? '' : 'none'; if (clearAllBtn) clearAllBtn.style.display = queue.length ? '' : 'none'; }
async function downloadAll() { const done = queue.filter(x => x.status === 'done'); if (done.length < 2) return; downloadAllBtn.disabled = true; const entries = await Promise.all(done.map(async x => ({ name: x.name, data: new Uint8Array(await x.output.arrayBuffer()) }))); await downloadAsZip(entries, 'irisfiles-icons.zip'); downloadAllBtn.disabled = false; }
function notice(msg) { showPersistentNotice(dropZone, msg, { id: 'ico-notice', kind: 'warning' }); }
function esc(v) { const d = document.createElement('div'); d.textContent = v; return d.innerHTML; }
