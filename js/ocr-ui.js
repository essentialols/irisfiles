/**
 * IrisFiles - OCR UI Controller (standalone page)
 * Handles drop zone, language picker, progress display, and results.
 */

import { ocrPdf, getAvailableLanguages, getCachedLanguages } from './ocr-engine.js';
import { loadPendingFiles } from './smart-drop.js';
import { checkWorkload } from './device-tier.js';
import { showPersistentNotice } from './notice-ui.js';

let dropZone, fileInput, fileList, langSelect, actionBtn, clearBtn;
let progressArea, progressStatus, progressBar;
let resultsArea, resultsText, copyBtn, downloadBtn, summaryEl;
let currentFile = null;
let inputRevision = 0;

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function populateLanguages() {
  const languages = getAvailableLanguages();
  const cached = await getCachedLanguages();
  langSelect.innerHTML = '';
  for (const lang of languages) {
    const opt = document.createElement('option');
    opt.value = lang.code;
    opt.textContent = lang.name + ' (' + lang.size + ')' + (cached.includes(lang.code) ? ' (cached)' : '');
    langSelect.appendChild(opt);
  }
}

function resetRunControls() {
  actionBtn.disabled = false;
  actionBtn.textContent = 'Extract Text';
  langSelect.disabled = false;
  progressBar.classList.remove('done');
  progressBar.style.background = '';
}

function showFile(file) {
  inputRevision++;
  currentFile = file;
  fileList.innerHTML = '';
  const item = document.createElement('div');
  item.className = 'file-item';
  item.innerHTML = '<span class="file-item__name">' + file.name + '</span>' +
    '<span class="file-item__size">' + formatSize(file.size) + '</span>';
  fileList.appendChild(item);
  resetRunControls();
  actionBtn.style.display = '';
  clearBtn.style.display = '';
  resultsArea.style.display = 'none';
  progressArea.style.display = 'none';
}

function clearAll() {
  if (currentFile) inputRevision++;
  currentFile = null;
  fileList.innerHTML = '';
  resetRunControls();
  actionBtn.style.display = 'none';
  clearBtn.style.display = 'none';
  resultsArea.style.display = 'none';
  progressArea.style.display = 'none';
}

async function runOcr() {
  if (!currentFile) return;

  const runRevision = inputRevision;
  const sourceFile = currentFile;
  const current = () => runRevision === inputRevision;
  const warn = checkWorkload({ fileSizeMb: sourceFile.size / 1e6, isOcr: true });
  if (warn) showNotice(warn);

  actionBtn.disabled = true;
  actionBtn.textContent = 'Processing...';
  langSelect.disabled = true;
  progressArea.style.display = '';
  resultsArea.style.display = 'none';
  progressBar.style.width = '0%';
  progressBar.classList.remove('done');
  progressBar.style.background = '';

  try {
    const result = await ocrPdf(sourceFile, {
      lang: langSelect.value,
      onPageProgress(pageNum, total, status) {
        if (current()) progressStatus.textContent = 'Page ' + pageNum + '/' + total + ': ' + status;
      },
      onOverallProgress(pct) {
        if (current()) progressBar.style.width = Math.round(pct * 100) + '%';
      },
    });

    if (!current()) return;
    progressBar.style.width = '100%';
    progressBar.classList.add('done');
    progressStatus.textContent = 'Done!';

    const textPages = result.pages.filter(p => p.method === 'text').length;
    const ocrPages = result.pages.filter(p => p.method === 'ocr').length;
    summaryEl.textContent = result.pages.length + ' pages processed' +
      (textPages > 0 || ocrPages > 0 ? ' (' + textPages + ' text, ' + ocrPages + ' OCR)' : '');

    resultsText.value = result.fullText;
    resultsArea.style.display = '';
  } catch (e) {
    if (!current()) return;
    progressStatus.textContent = 'Error: ' + (e.message || 'OCR failed');
    progressBar.style.width = '100%';
    progressBar.classList.remove('done');
    progressBar.style.background = 'var(--danger)';
  } finally {
    if (current()) {
      actionBtn.disabled = false;
      actionBtn.textContent = 'Extract Text';
      langSelect.disabled = false;
    }
  }
}

function copyText() {
  navigator.clipboard.writeText(resultsText.value).then(() => {
    const orig = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = orig; }, 1500);
  });
}

function downloadTxt() {
  const blob = new Blob([resultsText.value], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (currentFile ? currentFile.name.replace(/\.[^.]+$/, '') : 'ocr-result') + '.txt';
  a.click();
  URL.revokeObjectURL(url);
}

function showNotice(msg) {
  showPersistentNotice(dropZone, msg, { id: 'cf-notice', kind: 'warning' });
}

function addFiles(fileArray) {
  const pdfs = Array.from(fileArray).filter(f =>
    f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
  );
  if (pdfs.length > 0) showFile(pdfs[0]);
}

export function init() {
  dropZone = document.getElementById('drop-zone');
  fileInput = document.getElementById('file-input');
  fileList = document.getElementById('file-list');
  langSelect = document.getElementById('ocr-lang');
  actionBtn = document.getElementById('action-btn');
  clearBtn = document.getElementById('clear-all');
  progressArea = document.getElementById('ocr-progress');
  progressStatus = document.getElementById('ocr-progress-status');
  progressBar = document.getElementById('ocr-progress-bar');
  resultsArea = document.getElementById('ocr-results');
  resultsText = document.getElementById('ocr-results-text');
  copyBtn = document.getElementById('ocr-copy');
  downloadBtn = document.getElementById('ocr-download');
  summaryEl = document.getElementById('ocr-summary');

  populateLanguages();

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    addFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });

  actionBtn.addEventListener('click', runOcr);
  clearBtn.addEventListener('click', clearAll);
  copyBtn.addEventListener('click', copyText);
  downloadBtn.addEventListener('click', downloadTxt);

  // FAQ accordion
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.parentElement;
      item.classList.toggle('open');
    });
  });

  // Auto-load files from IndexedDB (from landing page smart drop)
  loadPendingFiles().then(files => {
    if (files && files.length > 0) addFiles(files);
  });
}
