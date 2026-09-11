/** IrisFiles - Image OCR page UI. */
import { ocrImage, getAvailableLanguages, getCachedLanguages } from './image-ocr-engine.js';
import { validateFile, formatSize, downloadBlob } from './converter.js';
import { loadPendingFiles } from './smart-drop.js';
import { checkWorkload } from './device-tier.js';
import { showPersistentNotice } from './notice-ui.js';

let file = null;
let dropZone, fileInput, fileList, langSelect, actionBtn, clearBtn, progressArea, progressStatus, progressBar, resultsArea, resultsText, summary;

export async function init() {
  dropZone = document.getElementById('drop-zone'); fileInput = document.getElementById('file-input'); fileList = document.getElementById('file-list');
  langSelect = document.getElementById('ocr-lang'); actionBtn = document.getElementById('action-btn'); clearBtn = document.getElementById('clear-all');
  progressArea = document.getElementById('ocr-progress'); progressStatus = document.getElementById('ocr-progress-status'); progressBar = document.getElementById('ocr-progress-bar');
  resultsArea = document.getElementById('ocr-results'); resultsText = document.getElementById('ocr-results-text'); summary = document.getElementById('ocr-summary');
  if (!dropZone || !fileInput) return;
  await populateLanguages();
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('dragover'); choose(e.dataTransfer.files); });
  fileInput.addEventListener('change', () => { choose(fileInput.files); fileInput.value = ''; });
  actionBtn.addEventListener('click', run);
  clearBtn.addEventListener('click', clear);
  document.getElementById('ocr-copy').addEventListener('click', copy);
  document.getElementById('ocr-download').addEventListener('click', download);
  document.querySelectorAll('.faq-question').forEach(btn => btn.addEventListener('click', () => btn.parentElement.classList.toggle('open')));
  loadPendingFiles().then(files => { if (files?.length) choose(files); }).catch(() => {});
}

async function populateLanguages() {
  const cached = await getCachedLanguages();
  langSelect.innerHTML = '';
  for (const lang of getAvailableLanguages()) {
    const option = document.createElement('option'); option.value = lang.code;
    option.textContent = `${lang.name} (${lang.size})${cached.includes(lang.code) ? ' (cached)' : ''}`;
    langSelect.appendChild(option);
  }
}

function choose(files) {
  const candidate = Array.from(files).find(f => /\.(jpe?g|png|webp|bmp)$/i.test(f.name) || /^image\/(jpeg|png|webp|bmp)$/.test(f.type));
  if (!candidate) return notice('Choose a JPG, PNG, WebP, or BMP image.');
  try { validateFile(candidate); } catch (err) { return notice(err.message); }
  file = candidate;
  fileList.innerHTML = `<div class="file-item"><div class="file-item__info"><div class="file-item__name">${esc(file.name)}</div><div class="file-item__meta">${formatSize(file.size)}</div></div></div>`;
  actionBtn.style.display = ''; clearBtn.style.display = ''; resultsArea.style.display = 'none'; progressArea.style.display = 'none';
}

async function run() {
  if (!file) return;
  const warn = checkWorkload({ fileSizeMb: file.size / 1e6, isOcr: true }); if (warn) notice(warn);
  actionBtn.disabled = true; actionBtn.textContent = 'Processing...'; resultsArea.style.display = 'none'; progressArea.style.display = ''; progressBar.style.width = '0%';
  try {
    const result = await ocrImage(file, { lang: langSelect.value, onProgress(pct, status) { progressBar.style.width = `${Math.round(pct * 100)}%`; progressStatus.textContent = status; } });
    resultsText.value = result.fullText;
    summary.textContent = result.confidence == null ? 'Image processed locally with OCR.' : `Image processed locally · OCR confidence ${Math.round(result.confidence)}%`;
    resultsArea.style.display = ''; progressStatus.textContent = 'Done!'; progressBar.style.width = '100%'; progressBar.classList.add('done');
  } catch (err) {
    progressStatus.textContent = `Error: ${err.message || 'OCR failed'}`; progressBar.style.width = '100%';
  } finally { actionBtn.disabled = false; actionBtn.textContent = 'Extract Text'; }
}
function copy() { navigator.clipboard.writeText(resultsText.value).then(() => notice('Text copied to clipboard.')); }
function download() { if (!file) return; downloadBlob(new Blob([resultsText.value], { type: 'text/plain' }), file.name.replace(/\.[^.]+$/, '') + '.txt'); }
function clear() { file = null; fileList.innerHTML = ''; actionBtn.style.display = clearBtn.style.display = 'none'; resultsArea.style.display = progressArea.style.display = 'none'; }
function notice(msg) { showPersistentNotice(dropZone, msg, { id: 'image-ocr-notice', kind: 'warning' }); }
function esc(v) { const d = document.createElement('div'); d.textContent = v; return d.innerHTML; }
