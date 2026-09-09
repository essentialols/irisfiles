/** IrisFiles - Image OCR engine. */
import { getAvailableLanguages, getCachedLanguages } from './ocr-engine.js';
import { validateDimensions } from './converter.js';

export { getAvailableLanguages, getCachedLanguages };

const TESS_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
let tessPromise = null;

function loadTesseract() {
  if (tessPromise) return tessPromise;
  tessPromise = new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve(window.Tesseract);
    const script = document.createElement('script');
    script.src = TESS_CDN;
    script.onload = () => resolve(window.Tesseract);
    script.onerror = () => { tessPromise = null; reject(new Error('Failed to load OCR engine. Check your internet connection.')); };
    document.head.appendChild(script);
  });
  return tessPromise;
}

function preprocess(canvas) {
  const ctx = canvas.getContext('2d');
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    data[i] = data[i + 1] = data[i + 2] = gray;
    hist[gray] += 1;
  }
  const total = data.length / 4;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, weightB = 0, best = -1, threshold = 127;
  for (let t = 0; t < 256; t++) {
    weightB += hist[t];
    if (!weightB) continue;
    const weightF = total - weightB;
    if (!weightF) break;
    sumB += t * hist[t];
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;
    const variance = weightB * weightF * (meanB - meanF) ** 2;
    if (variance > best) { best = variance; threshold = t; }
  }
  for (let i = 0; i < data.length; i += 4) {
    const value = data[i] >= threshold ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = value;
  }
  ctx.putImageData(image, 0, 0);
}

async function decodeImage(file) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { image: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() };
  } catch {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
      return { image, width: image.naturalWidth, height: image.naturalHeight, cleanup: () => URL.revokeObjectURL(url) };
    } catch {
      URL.revokeObjectURL(url);
      throw new Error('Could not decode this image. Try JPG, PNG, WebP, or BMP.');
    }
  }
}

export async function ocrImage(file, opts = {}) {
  const { lang = 'eng', onProgress = () => {} } = opts;
  onProgress(0.05, 'Decoding image...');
  const decoded = await decodeImage(file);
  try {
    const scale = decoded.width < 1600 ? Math.min(2, 1600 / Math.max(decoded.width, 1)) : 1;
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    validateDimensions(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
    ctx.drawImage(decoded.image, 0, 0, width, height);
    onProgress(0.2, 'Preparing text...');
    preprocess(canvas);

    const Tesseract = await loadTesseract();
    onProgress(0.3, 'Loading language model...');
    const worker = await Tesseract.createWorker(lang, 1);
    try {
      onProgress(0.45, 'Recognizing text...');
      const { data } = await worker.recognize(canvas);
      onProgress(1, 'Done');
      return { fullText: (data.text || '').trim(), confidence: data.confidence ?? null };
    } finally {
      await worker.terminate();
      canvas.width = 1; canvas.height = 1;
    }
  } finally {
    decoded.cleanup();
  }
}
