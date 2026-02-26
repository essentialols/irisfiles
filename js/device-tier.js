/**
 * IrisFiles - Device capability detection
 * Classifies device into low/mid/high tier based on available browser signals.
 * Used to warn users before operations that may be too heavy for their hardware.
 */

let _cached = null;

const LOW_GPUS = [
  /mali-[34]/i, /mali-g5[012]/i,
  /adreno.*[23]\d{2}/i, /adreno.*4[01]\d/i,
  /powervr\s*sgx/i, /powervr\s*ge8/i,
  /intel.*hd\s*(2|3|4)\d{3}/i, /intel.*uhd\s*6[01]\d/i,
  /gm108/i, /gt\s*7[12]0/i, /gt\s*6[34]0/i,
  /apple\s*a[789]\b/i, /apple\s*a1[01]\b/i,
  /videocore/i,
  /swiftshader/i, /llvmpipe/i, /software/i,
];

const HIGH_GPUS = [
  /apple\s*m[1-9]/i,
  /nvidia.*rtx/i, /nvidia.*gtx\s*1[6-9]/i, /nvidia.*gtx\s*[234]\d/i,
  /radeon.*rx\s*[5-9]\d{3}/i, /radeon.*rx\s*[67]\d{3}/i,
  /intel.*arc/i, /intel.*iris\s*xe/i,
  /apple\s*a1[5-9]/i, /apple\s*a[2-9]\d/i,
];

function detectGpu() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    const vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : null;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { renderer, vendor };
  } catch {
    return null;
  }
}

function gpuTier(renderer) {
  if (!renderer) return 'mid';
  for (const pat of LOW_GPUS) {
    if (pat.test(renderer)) return 'low';
  }
  for (const pat of HIGH_GPUS) {
    if (pat.test(renderer)) return 'high';
  }
  return 'mid';
}

function isMobile() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    ('ontouchstart' in window && navigator.maxTouchPoints > 1);
}

/**
 * Detect device capability tier. Results are cached after first call.
 * @returns {{ tier: 'low'|'mid'|'high', memory: number|null, cores: number|null, gpu: string|null, mobile: boolean }}
 */
export function getDeviceTier() {
  if (_cached) return _cached;

  const memory = navigator.deviceMemory || null;  // Chrome-only, GB
  const cores = navigator.hardwareConcurrency || null;
  const gpuInfo = detectGpu();
  const gpu = gpuInfo?.renderer || null;
  const mobile = isMobile();

  // Score: each signal contributes -1 (low), 0 (mid), or +1 (high)
  let score = 0;
  let signals = 0;

  if (memory != null) {
    signals++;
    if (memory <= 2) score--;
    else if (memory >= 8) score++;
  }

  if (cores != null) {
    signals++;
    if (cores <= 2) score--;
    else if (cores >= 8) score++;
  }

  if (gpu) {
    signals++;
    const gt = gpuTier(gpu);
    if (gt === 'low') score--;
    else if (gt === 'high') score++;
  }

  if (mobile) score -= 0.5;

  // Classify
  let tier;
  if (signals === 0) {
    tier = 'mid'; // can't tell, assume mid
  } else if (score <= -1) {
    tier = 'low';
  } else if (score >= 1.5) {
    tier = 'high';
  } else {
    tier = 'mid';
  }

  _cached = { tier, memory, cores, gpu, mobile };
  return _cached;
}

/**
 * Check whether a workload is risky for this device.
 * @param {object} opts
 * @param {number} [opts.fileSizeMb] - File size in MB
 * @param {number} [opts.megapixels] - Image megapixels (width*height/1e6)
 * @param {number} [opts.batchSize] - Number of files in batch
 * @param {boolean} [opts.isVideo] - Video processing (FFmpeg WASM)
 * @param {boolean} [opts.isOcr] - OCR processing (Tesseract WASM)
 * @returns {string|null} Warning message, or null if fine
 */
export function checkWorkload(opts = {}) {
  const { tier, mobile } = getDeviceTier();
  const warnings = [];

  if (tier === 'low') {
    if (opts.fileSizeMb > 20)
      warnings.push('This file is large for your device and may be slow to process.');
    if (opts.megapixels > 15)
      warnings.push('This image is high-resolution and may be slow on your device.');
    if (opts.batchSize > 10)
      warnings.push('Processing ' + opts.batchSize + ' files at once may be slow on your device.');
    if (opts.isVideo)
      warnings.push('Video processing requires significant resources and may be slow on your device.');
    if (opts.isOcr)
      warnings.push('OCR requires significant resources and may be slow on your device.');
  } else if (tier === 'mid') {
    if (opts.fileSizeMb > 50)
      warnings.push('This is a large file and may take a moment to process.');
    if (opts.megapixels > 40)
      warnings.push('This is a very high-resolution image and may take a moment.');
    if (opts.batchSize > 30)
      warnings.push('Large batch; processing may take a while.');
    if (opts.isVideo && mobile)
      warnings.push('Video processing on mobile may be slow.');
  }
  // high tier: no warnings

  return warnings.length > 0 ? warnings[0] : null;
}
