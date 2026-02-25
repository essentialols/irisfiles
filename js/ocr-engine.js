/**
 * IrisFiles - OCR Engine
 * Two-stage pipeline: PDF.js text extraction, then tesseract.js OCR for image-only pages.
 * No DOM dependencies. Pure logic.
 */

const PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.worker.min.mjs';
const TESS_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

let _tessLoaded = null;
function loadTesseract() {
  if (_tessLoaded) return _tessLoaded;
  _tessLoaded = new Promise((resolve, reject) => {
    if (window.Tesseract) { resolve(window.Tesseract); return; }
    const s = document.createElement('script');
    s.src = TESS_CDN;
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => { _tessLoaded = null; reject(new Error('Failed to load Tesseract.js')); };
    document.head.appendChild(s);
  });
  return _tessLoaded;
}

const LANGUAGES = [
  { code: 'eng', name: 'English', size: '~4 MB' },
  { code: 'deu', name: 'German', size: '~2 MB' },
  { code: 'fra', name: 'French', size: '~2 MB' },
  { code: 'spa', name: 'Spanish', size: '~2 MB' },
  { code: 'ita', name: 'Italian', size: '~3 MB' },
  { code: 'por', name: 'Portuguese', size: '~2 MB' },
  { code: 'nld', name: 'Dutch', size: '~3 MB' },
  { code: 'pol', name: 'Polish', size: '~3 MB' },
  { code: 'rus', name: 'Russian', size: '~3 MB' },
  { code: 'jpn', name: 'Japanese', size: '~5 MB' },
  { code: 'chi_sim', name: 'Chinese (Simplified)', size: '~3 MB' },
  { code: 'chi_tra', name: 'Chinese (Traditional)', size: '~3 MB' },
  { code: 'kor', name: 'Korean', size: '~3 MB' },
  { code: 'ara', name: 'Arabic', size: '~2 MB' },
  { code: 'hin', name: 'Hindi', size: '~3 MB' },
];

export function getAvailableLanguages() {
  return LANGUAGES;
}

export async function getCachedLanguages() {
  try {
    const cache = await caches.open('tesseract-traineddata');
    const keys = await cache.keys();
    const cached = [];
    for (const lang of LANGUAGES) {
      if (keys.some(k => k.url.includes(lang.code))) cached.push(lang.code);
    }
    return cached;
  } catch {
    return [];
  }
}

// Grayscale conversion (in-place)
function grayscale(imageData) {
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = gray;
  }
}

// Otsu binarization (in-place, assumes grayscale)
function otsuBinarize(imageData) {
  const d = imageData.data;
  const hist = new Array(256).fill(0);
  const total = d.length / 4;
  for (let i = 0; i < d.length; i += 4) hist[d[i]]++;

  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0, wB = 0, maxVar = 0, threshold = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) * (mB - mF);
    if (variance > maxVar) {
      maxVar = variance;
      threshold = t;
    }
  }

  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] >= threshold ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
}

function preprocessCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  grayscale(imageData);
  otsuBinarize(imageData);
  ctx.putImageData(imageData, 0, 0);
}

async function loadPdfJs() {
  const pdfjs = await import(PDFJS_CDN);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  return pdfjs;
}

async function extractPageText(page) {
  const content = await page.getTextContent();
  return content.items.map(item => item.str).join(' ').trim();
}

async function renderPageToCanvas(page, dpi) {
  const scale = dpi / 72;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/**
 * @param {File} file
 * @param {{ lang?: string, onPageProgress?: Function, onOverallProgress?: Function }} opts
 * @returns {{ pages: Array<{ pageNum: number, text: string, method: string }>, fullText: string }}
 */
export async function ocrPdf(file, opts = {}) {
  const { lang = 'eng', onPageProgress, onOverallProgress } = opts;
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const totalPages = pdf.numPages;
  const pages = [];
  const ocrNeeded = [];

  // Stage 1: try text extraction for all pages
  for (let i = 1; i <= totalPages; i++) {
    if (onPageProgress) onPageProgress(i, totalPages, 'Extracting text...');
    if (onOverallProgress) onOverallProgress((i - 1) / totalPages * 0.3);
    const page = await pdf.getPage(i);
    const text = await extractPageText(page);
    if (text.length > 50) {
      pages.push({ pageNum: i, text, method: 'text' });
    } else {
      pages.push({ pageNum: i, text: '', method: 'ocr' });
      ocrNeeded.push(i);
    }
  }

  // Stage 2: OCR for pages without text
  if (ocrNeeded.length > 0) {
    const Tesseract = await loadTesseract();
    const worker = await Tesseract.createWorker(lang, 1);

    for (let idx = 0; idx < ocrNeeded.length; idx++) {
      const pageNum = ocrNeeded[idx];
      if (onPageProgress) onPageProgress(pageNum, totalPages, 'Running OCR...');
      if (onOverallProgress) onOverallProgress(0.3 + (idx / ocrNeeded.length) * 0.7);

      const page = await pdf.getPage(pageNum);
      const canvas = await renderPageToCanvas(page, 200);
      preprocessCanvas(canvas);

      const { data: result } = await worker.recognize(canvas);
      const pageEntry = pages.find(p => p.pageNum === pageNum);
      pageEntry.text = result.text.trim();
    }

    await worker.terminate();
  }

  if (onOverallProgress) onOverallProgress(1);

  const fullText = pages.map(p => p.text).join('\n\n');
  return { pages, fullText };
}
