/**
 * IrisFiles - background removal engine.
 * Best: BiRefNet-lite 512 (MIT), fp16/WebGPU via Transformers.js.
 * Fast/fallback: U2NETP (Apache-2.0), 4.36 MiB via ONNX Runtime Web/WASM.
 * The source image is never uploaded; only model/runtime assets are downloaded.
 */
import { validateDimensions } from './converter.js';
import { getDeviceTier } from './device-tier.js';

const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/';
const BEST_MODEL = 'studioludens/birefnet-lite-512';
const FAST_MODEL_URL = 'https://huggingface.co/edgetools/u2netp/resolve/main/u2netp.onnx';
const FAST_MODEL_CACHE = 'irisfiles-bg-models-v1';
const FAST_MODEL_CACHE_KEY = '/models/u2netp-309c8469.onnx';
const MAX_BG_PIXELS = 40_000_000;

let bestBundlePromise = null;
let ortPromise = null;
let fastSessionPromise = null;

export function getBackgroundRemovalCapabilities() {
  const device = getDeviceTier();
  const webgpu = typeof navigator !== 'undefined' && !!navigator.gpu;
  const bestRecommended = webgpu && device.tier !== 'low' && !device.mobile;
  return { webgpu, bestRecommended, recommendedMode: bestRecommended ? 'best' : 'fast', device };
}

function report(onProgress, phase, progress, message, extra = {}) {
  onProgress?.({ phase, progress: Math.max(0, Math.min(1, progress)), message, ...extra });
}

function modelProgressAdapter(onProgress, label, base, span) {
  return info => {
    let p = null;
    if (typeof info?.progress === 'number') p = info.progress > 1 ? info.progress / 100 : info.progress;
    if (p == null && Number.isFinite(info?.loaded) && Number.isFinite(info?.total) && info.total > 0) p = info.loaded / info.total;
    const file = info?.file || info?.name || '';
    report(onProgress, 'model', base + (p == null ? 0 : p * span), file ? `${label}: ${String(file).split('/').pop()}` : label);
  };
}

async function loadBestBundle(onProgress) {
  if (bestBundlePromise) return bestBundlePromise;
  bestBundlePromise = (async () => {
    report(onProgress, 'model', 0.02, 'Loading best-quality AI runtime…');
    const transformers = await import(TRANSFORMERS_CDN);
    transformers.env.allowLocalModels = false;
    transformers.env.useBrowserCache = true;
    const progress = modelProgressAdapter(onProgress, 'Downloading best-quality model', 0.03, 0.42);
    const [model, processor] = await Promise.all([
      transformers.AutoModel.from_pretrained(BEST_MODEL, { dtype: 'fp16', device: 'webgpu', progress_callback: progress }),
      transformers.AutoProcessor.from_pretrained(BEST_MODEL, { progress_callback: progress }),
    ]);
    return { transformers, model, processor };
  })();
  try { return await bestBundlePromise; }
  catch (error) { bestBundlePromise = null; throw error; }
}

async function loadOrt() {
  if (ortPromise) return ortPromise;
  ortPromise = (async () => {
    const ort = await import(`${ORT_CDN}ort.wasm.min.mjs`);
    ort.env.wasm.wasmPaths = ORT_CDN;
    // No COOP/COEP today, so avoid a threaded WASM runtime that would need
    // cross-origin isolation. The fallback model is small enough single-threaded.
    ort.env.wasm.numThreads = 1;
    return ort;
  })();
  return ortPromise;
}

async function fetchCachedFastModel(onProgress) {
  try {
    const cached = await (await caches.open(FAST_MODEL_CACHE)).match(FAST_MODEL_CACHE_KEY);
    if (cached) {
      report(onProgress, 'model', 0.28, 'Using cached fast model');
      return cached.arrayBuffer();
    }
  } catch {}

  report(onProgress, 'model', 0.03, 'Downloading fast model (~4.4 MB)…');
  const response = await fetch(FAST_MODEL_URL, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Could not download background-removal model (${response.status}).`);
  const total = Number(response.headers.get('content-length')) || 0;

  let bytes;
  if (response.body && total) {
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      report(onProgress, 'model', 0.03 + Math.min(0.25, loaded / total * 0.25), `Downloading fast model… ${Math.round(loaded / total * 100)}%`);
    }
    const merged = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
    bytes = merged.buffer;
  } else {
    bytes = await response.arrayBuffer();
  }

  try {
    const cache = await caches.open(FAST_MODEL_CACHE);
    await cache.put(FAST_MODEL_CACHE_KEY, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } }));
  } catch {}
  return bytes;
}

async function loadFastSession(onProgress) {
  if (fastSessionPromise) return fastSessionPromise;
  fastSessionPromise = (async () => {
    const [ort, bytes] = await Promise.all([loadOrt(), fetchCachedFastModel(onProgress)]);
    report(onProgress, 'model', 0.3, 'Initializing fast model…');
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return { ort, session };
  })();
  try { return await fastSessionPromise; }
  catch (error) { fastSessionPromise = null; throw error; }
}

async function decodeImage(file) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { image: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() };
  } catch {
    const url = URL.createObjectURL(file);
    const image = new Image(); image.src = url;
    try {
      await image.decode();
      return { image, width: image.naturalWidth, height: image.naturalHeight, cleanup: () => URL.revokeObjectURL(url) };
    } catch {
      URL.revokeObjectURL(url);
      throw new Error('Could not decode this image. Try JPG, PNG, WebP, or BMP.');
    }
  }
}

function validateBackgroundImage(width, height) {
  validateDimensions(width, height);
  if (width * height > MAX_BG_PIXELS) {
    throw new Error(`Image is too large for background removal (${Math.round(width * height / 1e6)}MP). Maximum is ${Math.round(MAX_BG_PIXELS / 1e6)}MP.`);
  }
}

// The matte is stored in the canvas ALPHA channel. That matters because Canvas
// destination-in uses source alpha, not RGB luminance.
function makeMaskCanvas(values, width, height) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const image = ctx.createImageData(width, height);
  for (let i = 0; i < values.length; i++) {
    const v = Math.round(Math.max(0, Math.min(1, values[i])) * 255), j = i * 4;
    image.data[j] = image.data[j + 1] = image.data[j + 2] = 255;
    image.data[j + 3] = v;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

async function runBest(file, onProgress) {
  if (!navigator.gpu) throw new Error('Best quality requires WebGPU in this browser.');
  const { transformers, model, processor } = await loadBestBundle(onProgress);
  report(onProgress, 'inference', 0.48, 'Preparing image for best-quality model…');
  const raw = await transformers.RawImage.fromBlob(file);
  const processed = await processor(raw);
  report(onProgress, 'inference', 0.58, 'Finding foreground with BiRefNet…');
  const outputs = await model({ input_image: processed.pixel_values });
  const logits = outputs.logits || outputs[Object.keys(outputs)[0]];
  if (!logits?.dims || !logits?.data) throw new Error('Best-quality model returned an unexpected result.');
  const probabilities = logits.sigmoid ? logits.sigmoid() : logits;
  const dims = probabilities.dims, width = dims[dims.length - 1], height = dims[dims.length - 2];
  const values = new Float32Array(width * height), data = probabilities.data;
  for (let i = 0; i < values.length; i++) values[i] = Number(data[i]);
  return { mask: makeMaskCanvas(values, width, height), model: 'BiRefNet-lite 512' };
}

function preprocessFast(image) {
  const size = 320, plane = size * size;
  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, size, size);
  const pixels = ctx.getImageData(0, 0, size, size).data;
  const tensor = new Float32Array(plane * 3);
  let maxValue = 1 / 255;
  for (let i = 0; i < pixels.length; i += 4) maxValue = Math.max(maxValue, pixels[i] / 255, pixels[i + 1] / 255, pixels[i + 2] / 255);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
    tensor[p] = ((pixels[i] / 255) / maxValue - mean[0]) / std[0];
    tensor[plane + p] = ((pixels[i + 1] / 255) / maxValue - mean[1]) / std[1];
    tensor[plane * 2 + p] = ((pixels[i + 2] / 255) / maxValue - mean[2]) / std[2];
  }
  canvas.width = canvas.height = 1;
  return tensor;
}

async function runFast(decoded, onProgress) {
  const { ort, session } = await loadFastSession(onProgress);
  report(onProgress, 'inference', 0.4, 'Preparing image for fast model…');
  const input = new ort.Tensor('float32', preprocessFast(decoded.image), [1, 3, 320, 320]);
  report(onProgress, 'inference', 0.5, 'Finding foreground with U²-Netp…');
  const outputs = await session.run({ [session.inputNames[0]]: input });
  const output = outputs[session.outputNames[0]] || outputs[Object.keys(outputs)[0]];
  if (!output?.data) throw new Error('Fast model returned an unexpected result.');
  const raw = output.data;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < raw.length; i++) { const v = Number(raw[i]); if (v < min) min = v; if (v > max) max = v; }
  const span = Math.max(1e-6, max - min), values = new Float32Array(320 * 320);
  for (let i = 0; i < values.length; i++) values[i] = (Number(raw[i]) - min) / span;
  return { mask: makeMaskCanvas(values, 320, 320), model: 'U²-Netp' };
}

function fitSize(width, height, maxPixels, maxDim = 2400) {
  const scale = Math.min(1, maxDim / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function boxFilter(input, width, height, radius) {
  const tmp = new Float32Array(input.length), out = new Float32Array(input.length), window = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    const row = y * width; let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += input[row + Math.max(0, Math.min(width - 1, x))];
    for (let x = 0; x < width; x++) {
      tmp[row + x] = sum / window;
      sum += input[row + Math.max(0, Math.min(width - 1, x + radius + 1))] - input[row + Math.max(0, Math.min(width - 1, x - radius))];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.max(0, Math.min(height - 1, y)) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / window;
      sum += tmp[Math.max(0, Math.min(height - 1, y + radius + 1)) * width + x] - tmp[Math.max(0, Math.min(height - 1, y - radius)) * width + x];
    }
  }
  return out;
}

// Guided filter: edge-aware alpha refinement using original-image luminance as
// guidance. This snaps the low-resolution AI matte back onto real image edges.
function guidedRefine(sourceImageData, maskImageData, width, height, strength) {
  const count = width * height, I = new Float32Array(count), p = new Float32Array(count), Ip = new Float32Array(count), II = new Float32Array(count);
  const src = sourceImageData.data, mask = maskImageData.data;
  for (let i = 0; i < count; i++) {
    const j = i * 4;
    const lum = (0.2126 * src[j] + 0.7152 * src[j + 1] + 0.0722 * src[j + 2]) / 255;
    const alpha = mask[j + 3] / 255;
    I[i] = lum; p[i] = alpha; Ip[i] = lum * alpha; II[i] = lum * lum;
  }
  const radius = strength === 'strong' ? 5 : strength === 'soft' ? 3 : 4;
  const eps = strength === 'strong' ? 0.0025 : strength === 'soft' ? 0.012 : 0.006;
  const meanI = boxFilter(I, width, height, radius), meanP = boxFilter(p, width, height, radius), corrI = boxFilter(II, width, height, radius), corrIp = boxFilter(Ip, width, height, radius);
  const a = new Float32Array(count), b = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const variance = corrI[i] - meanI[i] * meanI[i], covariance = corrIp[i] - meanI[i] * meanP[i];
    a[i] = covariance / (variance + eps); b[i] = meanP[i] - a[i] * meanI[i];
  }
  const meanA = boxFilter(a, width, height, radius), meanB = boxFilter(b, width, height, radius);
  const output = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    const original = p[i]; let q = Math.max(0, Math.min(1, meanA[i] * I[i] + meanB[i]));
    if (original <= 0.015) q = 0;
    else if (original >= 0.985) q = 1;
    else {
      const low = strength === 'soft' ? 0.035 : 0.055, high = strength === 'soft' ? 0.965 : 0.945;
      const t = Math.max(0, Math.min(1, (q - low) / (high - low)));
      q = t * t * (3 - 2 * t);
    }
    const j = i * 4;
    output[j] = output[j + 1] = output[j + 2] = 255;
    output[j + 3] = Math.round(q * 255);
  }
  return new ImageData(output, width, height);
}

async function refineMask(decoded, rawMask, strength, onProgress) {
  report(onProgress, 'refine', 0.75, 'Refining edges against the original image…');
  const tier = getDeviceTier().tier;
  const maxPixels = tier === 'high' ? 2_000_000 : tier === 'low' ? 650_000 : 1_200_000;
  const size = fitSize(decoded.width, decoded.height, maxPixels);
  const sourceCanvas = document.createElement('canvas'), maskCanvas = document.createElement('canvas');
  sourceCanvas.width = maskCanvas.width = size.width; sourceCanvas.height = maskCanvas.height = size.height;
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true }), maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
  sourceCtx.drawImage(decoded.image, 0, 0, size.width, size.height);
  maskCtx.imageSmoothingEnabled = true; maskCtx.imageSmoothingQuality = 'high'; maskCtx.drawImage(rawMask, 0, 0, size.width, size.height);
  maskCtx.putImageData(guidedRefine(sourceCtx.getImageData(0, 0, size.width, size.height), maskCtx.getImageData(0, 0, size.width, size.height), size.width, size.height, strength), 0, 0);
  sourceCanvas.width = sourceCanvas.height = rawMask.width = rawMask.height = 1;
  return maskCanvas;
}

export async function generateBackgroundMask(file, options = {}, onProgress = () => {}) {
  const requested = options.quality || 'auto', edgeRefinement = options.edgeRefinement || 'normal';
  report(onProgress, 'decode', 0.01, 'Reading image…');
  const decoded = await decodeImage(file);
  try {
    validateBackgroundImage(decoded.width, decoded.height);
    const capabilities = getBackgroundRemovalCapabilities();
    let chosen = requested === 'auto' ? capabilities.recommendedMode : requested, result, fallbackReason = null;
    if (chosen === 'best') {
      try { result = await runBest(file, onProgress); }
      catch (error) {
        fallbackReason = error?.message || 'Best-quality model unavailable.';
        report(onProgress, 'model', 0.12, 'Best quality unavailable; switching to fast model…', { fallbackReason });
        result = await runFast(decoded, onProgress); chosen = 'fast';
      }
    } else result = await runFast(decoded, onProgress);
    const maskCanvas = await refineMask(decoded, result.mask, edgeRefinement, onProgress);
    report(onProgress, 'done', 1, 'Background removed');
    return { maskCanvas, width: decoded.width, height: decoded.height, maskWidth: maskCanvas.width, maskHeight: maskCanvas.height, model: result.model, quality: chosen, fallbackReason };
  } finally { decoded.cleanup(); }
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode output image.')), mime, quality));
}

export async function renderBackgroundResult(file, maskCanvas, options = {}) {
  const decoded = await decodeImage(file);
  try {
    validateBackgroundImage(decoded.width, decoded.height);
    const crop = !!options.crop, background = options.background || 'transparent', outputType = options.outputType || (background === 'transparent' ? 'png' : 'jpg');
    let cropBox = { x: 0, y: 0, width: decoded.width, height: decoded.height };
    if (crop) {
      const data = maskCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
      let minX = maskCanvas.width, minY = maskCanvas.height, maxX = -1, maxY = -1;
      for (let y = 0; y < maskCanvas.height; y++) for (let x = 0; x < maskCanvas.width; x++) {
        if (data[(y * maskCanvas.width + x) * 4 + 3] < 16) continue;
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
      if (maxX >= minX && maxY >= minY) {
        const pad = Math.round(Math.max(maxX - minX + 1, maxY - minY + 1) * 0.04);
        minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad); maxX = Math.min(maskCanvas.width - 1, maxX + pad); maxY = Math.min(maskCanvas.height - 1, maxY + pad);
        cropBox = {
          x: Math.floor(minX / maskCanvas.width * decoded.width), y: Math.floor(minY / maskCanvas.height * decoded.height),
          width: Math.max(1, Math.ceil((maxX - minX + 1) / maskCanvas.width * decoded.width)), height: Math.max(1, Math.ceil((maxY - minY + 1) / maskCanvas.height * decoded.height)),
        };
      }
    }

    const sourceCanvas = document.createElement('canvas'); sourceCanvas.width = decoded.width; sourceCanvas.height = decoded.height;
    const sourceCtx = sourceCanvas.getContext('2d'); sourceCtx.drawImage(decoded.image, 0, 0);
    sourceCtx.globalCompositeOperation = 'destination-in'; sourceCtx.imageSmoothingEnabled = true; sourceCtx.imageSmoothingQuality = 'high';
    sourceCtx.drawImage(maskCanvas, 0, 0, decoded.width, decoded.height); sourceCtx.globalCompositeOperation = 'source-over';

    const canvas = document.createElement('canvas'); canvas.width = cropBox.width; canvas.height = cropBox.height;
    const ctx = canvas.getContext('2d');
    if (background !== 'transparent') {
      ctx.fillStyle = background === 'white' ? '#fff' : background === 'black' ? '#000' : background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(sourceCanvas, cropBox.x, cropBox.y, cropBox.width, cropBox.height, 0, 0, cropBox.width, cropBox.height);
    sourceCanvas.width = sourceCanvas.height = 1;
    const mime = outputType === 'jpg' ? 'image/jpeg' : 'image/png';
    const blob = await canvasToBlob(canvas, mime, outputType === 'jpg' ? 0.94 : undefined);
    canvas.width = canvas.height = 1;
    return { blob, ext: outputType === 'jpg' ? 'jpg' : 'png', width: cropBox.width, height: cropBox.height };
  } finally { decoded.cleanup(); }
}

export function cloneMaskCanvas(maskCanvas) {
  const clone = document.createElement('canvas'); clone.width = maskCanvas.width; clone.height = maskCanvas.height;
  clone.getContext('2d').drawImage(maskCanvas, 0, 0); return clone;
}

export function paintMaskStroke(maskCanvas, points, options = {}) {
  if (!points?.length) return;
  const mode = options.mode === 'erase' ? 'erase' : 'restore', radius = Math.max(2, options.radius || 24), hardness = Math.max(0.1, Math.min(1, options.hardness ?? 0.8));
  const ctx = maskCanvas.getContext('2d');
  const drawPath = (lineWidth, alpha) => {
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over'; ctx.globalAlpha = alpha;
    ctx.strokeStyle = ctx.fillStyle = '#fff'; ctx.lineWidth = lineWidth;
    if (points.length === 1) { ctx.beginPath(); ctx.arc(points[0].x, points[0].y, lineWidth / 2, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y); for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y); ctx.stroke(); }
    ctx.restore();
  };
  if (hardness < 0.95) drawPath(radius * 2, 0.12 + (1 - hardness) * 0.28);
  drawPath(radius * 2 * Math.max(0.35, hardness), 1);
}
