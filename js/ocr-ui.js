/**
 * IrisFiles - OCR UI Controller (standalone page)
 * Handles drop zone, language picker, progress display, and results.
 */

import { ocrPdf, getAvailableLanguages, getCachedLanguages } from './ocr-engine.js';
import { loadPendingFiles } from './smart-drop.js';
import { checkWorkload } from './device-tier.js';

let dropZone, fileInput, fileList, langSelect, actionBtn, clearBtn;
let progressArea, progressStatus, progressBar;
let resultsArea, resultsText, copyBtn, downloadBtn, summaryEl;
let currentFile = null;

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

function showFile(file) {
  currentFile = file;
  fileList.innerHTML = '';
  const item = document.createElement('div');
  item.className = 'file-item';
  item.innerHTML = '<span class="file-item__name">' + file.name + '</span>' +
    '<span class="file-item__size">' + formatSize(file.size) + '</span>';
  fileList.appendChild(item);
  actionBtn.style.display = '';
  clearBtn.style.display = '';
  resultsArea.style.display = 'none';
  progressArea.style.display = 'none';
}

function clearAll() {
  currentFile = null;
  fileList.innerHTML = '';
  actionBtn.style.display = 'none';
  clearBtn.style.display = 'none';
  resultsArea.style.display = 'none';
  progressArea.style.display = 'none';
}

async function runOcr() {
  if (!currentFile) return;

  const warn = checkWorkload({ fileSizeMb: currentFile.size / 1e6, isOcr: true });
  if (warn) showNotice(warn);

  actionBtn.disabled = true;
  actionBtn.textContent = 'Processing...';
  progressArea.style.display = '';
  resultsArea.style.display = 'none';
  progressBar.style.width = '0%';
  progressBar.classList.remove('done');

  try {
    const result = await ocrPdf(currentFile, {
      lang: langSelect.value,
      onPageProgress(pageNum, total, status) {
        progressStatus.textContent = 'Page ' + pageNum + '/' + total + ': ' + status;
      },
      onOverallProgress(pct) {
        progressBar.style.width = Math.round(pct * 100) + '%';
      },
    });

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
    progressStatus.textContent = 'Error: ' + (e.message || 'OCR failed');
    progressBar.style.width = '100%';
    progressBar.classList.remove('done');
    progressBar.style.background = 'var(--danger)';
  } finally {
    actionBtn.disabled = false;
    actionBtn.textContent = 'Extract Text';
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
  let notice = document.getElementById('cf-notice');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'cf-notice';
    notice.className = 'notice';
    dropZone.parentElement.insertBefore(notice, dropZone.nextSibling);
  }
  notice.textContent = msg;
  notice.style.display = '';
  clearTimeout(notice._timer);
  notice._timer = setTimeout(() => { notice.style.display = 'none'; }, 5000);
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
