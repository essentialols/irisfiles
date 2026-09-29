/**
 * IrisFiles - Images to animated GIF engine
 * Takes multiple image files and assembles them into an animated GIF using gifenc.
 * Global palette built from all frames for consistent colors.
 */

const DEFAULT_DELAY = 100; // ms per frame
const DEFAULT_MAX_WIDTH = 640;
// GIF transparency is one bit, so alpha is a threshold, not a gradient.
const ALPHA_CUTOFF = 128;

/**
 * Convert multiple image files into an animated GIF.
 * @param {File[]} files - Image files in frame order
 * @param {object} opts - { delay, maxWidth, loop, onProgress }
 * @returns {Promise<Blob>} GIF blob
 */
export async function imagesToGif(files, opts = {}) {
  const delay = opts.delay || DEFAULT_DELAY;
  const maxWidth = opts.maxWidth || DEFAULT_MAX_WIDTH;
  const loop = opts.loop !== undefined ? opts.loop : 0; // 0 = infinite
  const onProgress = opts.onProgress || (() => {});

  if (files.length < 2) throw new Error('Need at least 2 images to create an animated GIF.');

  // Step 1: Load all images and determine uniform canvas size
  onProgress(0, 'Loading images...');
  const images = [];
  for (let i = 0; i < files.length; i++) {
    const bmp = await createImageBitmap(files[i], { imageOrientation: 'from-image' });
    images.push(bmp);
  }

  // Use first image's aspect ratio, scale to maxWidth
  const firstW = images[0].width;
  const firstH = images[0].height;
  const scale = Math.min(1, maxWidth / firstW);
  const w = Math.max(1, Math.round(firstW * scale));
  const h = Math.max(1, Math.round(firstH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get canvas context');

  // Keep the first frame's output canvas, but fit every image inside it without
  // stretching or cropping. Differing aspect ratios use transparent padding.
  // The canvas rounds width and height independently, so the frame that defined
  // the canvas can fit a pixel short and end up inset behind a transparent seam.
  // Close any sub-pixel gap instead of padding it.
  function drawFrame(img) {
    ctx.clearRect(0, 0, w, h);
    const fit = Math.min(w / img.width, h / img.height);
    const fitW = img.width * fit;
    const fitH = img.height * fit;
    const drawW = w - fitW <= 1 ? w : Math.max(1, Math.round(fitW));
    const drawH = h - fitH <= 1 ? h : Math.max(1, Math.round(fitH));
    const x = Math.round((w - drawW) / 2);
    const y = Math.round((h - drawH) / 2);
    ctx.drawImage(img, x, y, drawW, drawH);
  }

  // Step 2: Sample pixels from all frames for global palette
  onProgress(5, 'Building color palette...');
  const samplePixels = [];
  let hasTransparency = false;
  for (const img of images) {
    drawFrame(img);
    const data = ctx.getImageData(0, 0, w, h).data;
    if (!hasTransparency) {
      for (let j = 3; j < data.length; j += 4) {
        if (data[j] < ALPHA_CUTOFF) {
          hasTransparency = true;
          break;
        }
      }
    }
    const step = Math.max(1, Math.floor(data.length / 4 / 512));
    for (let j = 0; j < data.length; j += step * 4) {
      // Transparent pixels never reach the quantizer: index 0 is reserved for
      // them below, so every entry it produces is a colour a frame needs.
      if (data[j + 3] < ALPHA_CUTOFF) continue;
      // Keep alpha: quantize() reads the sample as RGBA and reinterprets the
      // buffer as a Uint32Array, which needs a length divisible by four.
      // Sampling only RGB made that throw and killed every GIF build.
      samplePixels.push(data[j], data[j + 1], data[j + 2], 255);
    }
  }

  const { GIFEncoder, quantize, applyPalette } = gifenc;
  // Reserve index 0 for transparency rather than asking the quantizer to keep a
  // zero-alpha entry: its cluster merge ignores alpha and can drop it, which
  // used to punch an opaque colour out of every frame. Reserving it also keeps
  // rgb565 (65536 buckets) for the colours instead of falling back to rgba4444.
  const colors = samplePixels.length
    ? quantize(new Uint8Array(samplePixels), hasTransparency ? 255 : 256)
    : [[0, 0, 0]];
  const palette = hasTransparency ? [[0, 0, 0, 0], ...colors] : colors;

  // Step 3: Encode each frame
  const gif = GIFEncoder();
  try {
    for (let i = 0; i < images.length; i++) {
      drawFrame(images[i]);
      const { data } = ctx.getImageData(0, 0, w, h);
      const index = applyPalette(data, colors, 'rgb565');
      if (hasTransparency) {
        for (let p = 0; p < index.length; p++) {
          index[p] = data[p * 4 + 3] < ALPHA_CUTOFF ? 0 : index[p] + 1;
        }
      }
      gif.writeFrame(index, w, h, {
        palette,
        delay,
        dispose: hasTransparency ? 2 : 0,
        transparent: hasTransparency,
        transparentIndex: 0,
        ...(i === 0 ? { repeat: loop } : {}),
      });

      const pct = 10 + Math.round((i / images.length) * 90);
      onProgress(pct, `Encoding frame ${i + 1} of ${images.length}...`);

      // Yield to keep UI responsive
      if (i % 3 === 0) await new Promise(r => setTimeout(r, 0));
    }

    gif.finish();
    const blob = new Blob([gif.bytes()], { type: 'image/gif' });
    onProgress(100, `Done: ${images.length} frames`);
    return blob;
  } finally {
    for (const img of images) img.close();
  }
}

export { DEFAULT_DELAY, DEFAULT_MAX_WIDTH };
