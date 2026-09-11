/** IrisFiles - background remover UI/editor. */
import {
  generateBackgroundMask,
  renderBackgroundResult,
  getBackgroundRemovalCapabilities,
  cloneMaskCanvas,
  paintMaskStroke,
} from './background-removal-engine.js';
import { validateFile, formatSize, downloadBlob } from './converter.js';
import { loadPendingFiles } from './smart-drop.js';
import { checkWorkload } from './device-tier.js';
import { showPersistentNotice } from './notice-ui.js';

let currentFile = null;
let sourceUrl = null;
let sourceImage = null;
let maskCanvas = null;
let initialMaskCanvas = null;
let strokes = [];
let activeStroke = null;
let processing = false;
let previewBackground = 'transparent';

let dropZone, fileInput, fileList, actionBtn, clearBtn, qualitySelect, edgeSelect;
let progressWrap, progressBar, progressStatus, modelNote, editor, previewCanvas;
let eraseBtn, restoreBtn, brushSize, brushHardness, undoBtn, resetBtn, cropToggle;
let transparentBtn, whiteBtn, blackBtn, customBtn, customColor;
let downloadPngBtn, downloadJpgBtn, downloadCurrentBtn, resultMeta;
let brushMode = 'erase';

export function init() {
  dropZone = document.getElementById('drop-zone');
  fileInput = document.getElementById('file-input');
  fileList = document.getElementById('file-list');
  actionBtn = document.getElementById('action-btn');
  clearBtn = document.getElementById('clear-all');
  qualitySelect = document.getElementById('bg-quality');
  edgeSelect = document.getElementById('edge-refinement');
  progressWrap = document.getElementById('bg-progress');
  progressBar = document.getElementById('bg-progress-bar');
  progressStatus = document.getElementById('bg-progress-status');
  modelNote = document.getElementById('bg-model-note');
  editor = document.getElementById('bg-editor');
  previewCanvas = document.getElementById('bg-preview-canvas');
  eraseBtn = document.getElementById('brush-erase');
  restoreBtn = document.getElementById('brush-restore');
  brushSize = document.getElementById('brush-size');
  brushHardness = document.getElementById('brush-hardness');
  undoBtn = document.getElementById('brush-undo');
  resetBtn = document.getElementById('brush-reset');
  cropToggle = document.getElementById('crop-subject');
  transparentBtn = document.getElementById('preview-transparent');
  whiteBtn = document.getElementById('preview-white');
  blackBtn = document.getElementById('preview-black');
  customBtn = document.getElementById('preview-custom');
  customColor = document.getElementById('background-color');
  downloadPngBtn = document.getElementById('download-transparent');
  downloadJpgBtn = document.getElementById('download-white');
  downloadCurrentBtn = document.getElementById('download-current');
  resultMeta = document.getElementById('bg-result-meta');

  if (!dropZone || !fileInput || !actionBtn) return;
  configureCapabilities();

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    chooseFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', () => { chooseFiles(fileInput.files); fileInput.value = ''; });
  actionBtn.addEventListener('click', removeBackground);
  clearBtn.addEventListener('click', clearAll);

  eraseBtn?.addEventListener('click', () => setBrushMode('erase'));
  restoreBtn?.addEventListener('click', () => setBrushMode('restore'));
  undoBtn?.addEventListener('click', undoStroke);
  resetBtn?.addEventListener('click', resetMask);
  transparentBtn?.addEventListener('click', () => setPreviewBackground('transparent'));
  whiteBtn?.addEventListener('click', () => setPreviewBackground('white'));
  blackBtn?.addEventListener('click', () => setPreviewBackground('black'));
  customBtn?.addEventListener('click', () => setPreviewBackground(customColor.value));
  customColor?.addEventListener('input', () => {
    if (previewBackground.startsWith('#')) setPreviewBackground(customColor.value);
  });
  downloadPngBtn?.addEventListener('click', () => downloadResult('transparent', 'png'));
  downloadJpgBtn?.addEventListener('click', () => downloadResult('white', 'jpg'));
  downloadCurrentBtn?.addEventListener('click', () => downloadResult(previewBackground, previewBackground === 'transparent' ? 'png' : 'jpg'));
  cropToggle?.addEventListener('change', updateResultMeta);

  setupBrushEvents();
  document.querySelectorAll('.faq-question').forEach(btn => btn.addEventListener('click', () => btn.parentElement.classList.toggle('open')));

  loadPendingFiles().then(files => { if (files?.length) chooseFiles(files); }).catch(() => {});
}

function configureCapabilities() {
  const caps = getBackgroundRemovalCapabilities();
  const bestOption = qualitySelect?.querySelector('option[value="best"]');
  if (bestOption && !caps.webgpu) {
    bestOption.disabled = true;
    bestOption.textContent = 'Best edges · WebGPU required';
  }
  if (qualitySelect) qualitySelect.value = 'auto';
  if (modelNote) {
    modelNote.textContent = caps.bestRecommended
      ? 'Auto will use Best edges on this device. The ~94 MB model downloads once and is browser-cached.'
      : 'Auto will use the fast ~4.4 MB model on this device. Best edges is available on supported WebGPU desktops.';
  }
}

function acceptedImage(file) {
  return /\.(jpe?g|png|webp|bmp)$/i.test(file?.name || '') || /^image\/(jpeg|png|webp|bmp)$/i.test(file?.type || '');
}

async function chooseFiles(files) {
  if (processing) return;
  const file = Array.from(files || []).find(acceptedImage);
  if (!file) return notice('Choose a JPG, PNG, WebP, or BMP image.');
  try { validateFile(file); } catch (error) { return notice(error.message); }

  currentFile = file;
  maskCanvas = null;
  initialMaskCanvas = null;
  strokes = [];
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  sourceUrl = URL.createObjectURL(file);
  sourceImage = new Image();
  sourceImage.src = sourceUrl;
  try { await sourceImage.decode(); } catch { return notice('Could not decode this image.'); }

  const megapixels = sourceImage.naturalWidth * sourceImage.naturalHeight / 1e6;
  const warn = checkWorkload({ fileSizeMb: file.size / 1e6, megapixels });
  if (warn) notice(warn);

  fileList.innerHTML = `
    <div class="file-item">
      <div class="file-item__info">
        <div class="file-item__name">${escapeHtml(file.name)}</div>
        <div class="file-item__meta">${formatSize(file.size)} · ${sourceImage.naturalWidth}×${sourceImage.naturalHeight}</div>
      </div>
    </div>`;
  actionBtn.style.display = '';
  clearBtn.style.display = '';
  editor.style.display = 'none';
  progressWrap.style.display = 'none';
  resultMeta.textContent = '';
}

async function removeBackground() {
  if (!currentFile || processing) return;
  processing = true;
  actionBtn.disabled = true;
  clearBtn.disabled = true;
  actionBtn.textContent = 'Removing background…';
  progressWrap.style.display = '';
  progressBar.style.width = '1%';
  progressBar.classList.remove('done');
  progressStatus.textContent = 'Starting…';
  editor.style.display = 'none';

  try {
    const result = await generateBackgroundMask(currentFile, {
      quality: qualitySelect.value,
      edgeRefinement: edgeSelect.value,
    }, info => {
      progressBar.style.width = `${Math.max(1, Math.round(info.progress * 100))}%`;
      progressStatus.textContent = info.message || 'Processing…';
    });

    maskCanvas = result.maskCanvas;
    initialMaskCanvas = cloneMaskCanvas(maskCanvas);
    strokes = [];
    progressBar.style.width = '100%';
    progressBar.classList.add('done');
    progressStatus.textContent = result.fallbackReason
      ? `Done with ${result.model}. Best mode fell back automatically.`
      : `Done with ${result.model}.`;
    modelNote.textContent = `${result.model} · ${result.maskWidth}×${result.maskHeight} editable matte${result.fallbackReason ? ` · fallback: ${result.fallbackReason}` : ''}`;
    editor.style.display = '';
    setBrushMode('erase');
    setPreviewBackground('transparent');
    updateUndoControls();
    await renderPreview();
    updateResultMeta();
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    progressBar.style.width = '100%';
    progressBar.classList.remove('done');
    progressStatus.textContent = `Error: ${error.message || 'Background removal failed.'}`;
  } finally {
    processing = false;
    actionBtn.disabled = false;
    clearBtn.disabled = false;
    actionBtn.textContent = maskCanvas ? 'Run Again' : 'Remove Background';
  }
}

function setBrushMode(mode) {
  brushMode = mode;
  eraseBtn?.classList.toggle('active', mode === 'erase');
  restoreBtn?.classList.toggle('active', mode === 'restore');
  eraseBtn?.setAttribute('aria-pressed', mode === 'erase' ? 'true' : 'false');
  restoreBtn?.setAttribute('aria-pressed', mode === 'restore' ? 'true' : 'false');
}

function maskPointFromEvent(event) {
  const rect = previewCanvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(maskCanvas.width, (event.clientX - rect.left) / rect.width * maskCanvas.width)),
    y: Math.max(0, Math.min(maskCanvas.height, (event.clientY - rect.top) / rect.height * maskCanvas.height)),
  };
}

function brushRadiusOnMask() {
  const previewWidth = Math.max(1, previewCanvas.getBoundingClientRect().width);
  return Number(brushSize.value || 36) / previewWidth * maskCanvas.width / 2;
}

function setupBrushEvents() {
  if (!previewCanvas) return;
  previewCanvas.addEventListener('pointerdown', event => {
    if (!maskCanvas || processing) return;
    event.preventDefault();
    previewCanvas.setPointerCapture(event.pointerId);
    activeStroke = {
      mode: brushMode,
      radius: brushRadiusOnMask(),
      hardness: Number(brushHardness.value || 80) / 100,
      points: [maskPointFromEvent(event)],
    };
    paintMaskStroke(maskCanvas, activeStroke.points, activeStroke);
    renderPreview();
  });
  previewCanvas.addEventListener('pointermove', event => {
    if (!activeStroke || !maskCanvas) return;
    event.preventDefault();
    const point = maskPointFromEvent(event);
    const last = activeStroke.points[activeStroke.points.length - 1];
    activeStroke.points.push(point);
    paintMaskStroke(maskCanvas, [last, point], activeStroke);
    renderPreviewThrottled();
  });
  const finish = event => {
    if (!activeStroke) return;
    try { previewCanvas.releasePointerCapture(event.pointerId); } catch {}
    strokes.push(activeStroke);
    activeStroke = null;
    updateUndoControls();
    renderPreview();
  };
  previewCanvas.addEventListener('pointerup', finish);
  previewCanvas.addEventListener('pointercancel', finish);
}

let previewFrame = null;
function renderPreviewThrottled() {
  if (previewFrame) return;
  previewFrame = requestAnimationFrame(() => {
    previewFrame = null;
    renderPreview();
  });
}

async function renderPreview() {
  if (!sourceImage || !maskCanvas || !previewCanvas) return;
  const containerWidth = Math.max(280, previewCanvas.parentElement?.clientWidth || 720);
  const scale = Math.min(1, containerWidth / sourceImage.naturalWidth, 560 / sourceImage.naturalHeight);
  const width = Math.max(1, Math.round(sourceImage.naturalWidth * scale));
  const height = Math.max(1, Math.round(sourceImage.naturalHeight * scale));
  if (previewCanvas.width !== width || previewCanvas.height !== height) {
    previewCanvas.width = width; previewCanvas.height = height;
  }
  const ctx = previewCanvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  if (previewBackground !== 'transparent') {
    ctx.fillStyle = previewBackground === 'white' ? '#fff' : previewBackground === 'black' ? '#000' : previewBackground;
    ctx.fillRect(0, 0, width, height);
  }

  const work = document.createElement('canvas');
  work.width = width; work.height = height;
  const wctx = work.getContext('2d');
  wctx.drawImage(sourceImage, 0, 0, width, height);
  wctx.globalCompositeOperation = 'destination-in';
  wctx.imageSmoothingEnabled = true;
  wctx.imageSmoothingQuality = 'high';
  wctx.drawImage(maskCanvas, 0, 0, width, height);
  ctx.drawImage(work, 0, 0);
  work.width = work.height = 1;
}

function setPreviewBackground(background) {
  previewBackground = background;
  [transparentBtn, whiteBtn, blackBtn, customBtn].forEach(btn => btn?.classList.remove('active'));
  if (background === 'transparent') transparentBtn?.classList.add('active');
  else if (background === 'white') whiteBtn?.classList.add('active');
  else if (background === 'black') blackBtn?.classList.add('active');
  else customBtn?.classList.add('active');
  renderPreview();
}

function replayStrokes() {
  if (!initialMaskCanvas || !maskCanvas) return;
  const ctx = maskCanvas.getContext('2d');
  ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  ctx.drawImage(initialMaskCanvas, 0, 0);
  for (const stroke of strokes) paintMaskStroke(maskCanvas, stroke.points, stroke);
  updateUndoControls();
  renderPreview();
}

function undoStroke() {
  if (!strokes.length) return;
  strokes.pop();
  replayStrokes();
}

function resetMask() {
  strokes = [];
  replayStrokes();
}

function updateUndoControls() {
  if (undoBtn) undoBtn.disabled = strokes.length === 0;
  if (resetBtn) resetBtn.disabled = strokes.length === 0;
}

function updateResultMeta() {
  if (!currentFile || !sourceImage || !resultMeta) return;
  resultMeta.textContent = `${sourceImage.naturalWidth}×${sourceImage.naturalHeight} · ${cropToggle?.checked ? 'trim transparent edges on download' : 'keep original canvas size'}`;
}

async function downloadResult(background, outputType) {
  if (!currentFile || !maskCanvas) return;
  const buttons = [downloadPngBtn, downloadJpgBtn, downloadCurrentBtn].filter(Boolean);
  buttons.forEach(btn => btn.disabled = true);
  try {
    const result = await renderBackgroundResult(currentFile, maskCanvas, {
      background,
      outputType,
      crop: !!cropToggle?.checked,
    });
    const base = currentFile.name.replace(/\.[^.]+$/, '');
    const suffix = background === 'transparent' ? 'no-bg' : background === 'white' ? 'white-bg' : 'new-bg';
    downloadBlob(result.blob, `${base}-${suffix}.${result.ext}`);
  } catch (error) {
    notice(error.message || 'Could not create the download.');
  } finally {
    buttons.forEach(btn => btn.disabled = false);
  }
}

function clearAll() {
  currentFile = null;
  maskCanvas = null;
  initialMaskCanvas = null;
  strokes = [];
  activeStroke = null;
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  sourceUrl = null;
  sourceImage = null;
  fileList.innerHTML = '';
  actionBtn.style.display = 'none';
  clearBtn.style.display = 'none';
  editor.style.display = 'none';
  progressWrap.style.display = 'none';
  progressBar.classList.remove('done');
  progressBar.style.width = '0%';
}

function notice(message) {
  showPersistentNotice(dropZone, message, { id: 'background-remover-notice', kind: 'warning' });
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}
