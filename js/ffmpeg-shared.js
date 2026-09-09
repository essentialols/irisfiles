/**
 * IrisFiles - Shared FFmpeg.wasm loader
 * Single instance reused by video and audio engines.
 * Lazy-loads ~25MB WASM binary from CDN on first use (~10MB with Brotli).
 */

let ffmpegInstance = null;
let loadingPromise = null;
const CDN = 'https://cdn.jsdelivr.net/npm';

async function loadScript(url) {
  if (document.querySelector(`script[src="${url}"]`)) return;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load video converter. Check your internet connection.'));
    document.head.appendChild(s);
  });
}

/**
 * Re-host a CDN asset on this origin as a blob URL.
 *
 * A classic Worker script must be same-origin: the browser rejects
 * `new Worker('https://cdn...')` regardless of what the CSP allows. FFmpeg
 * spawns its worker relative to its own CDN script, so every FFmpeg conversion
 * failed with a SecurityError until the worker is handed over as a blob.
 */
async function toBlobURL(url, mimeType) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to load video converter. Check your internet connection.');
  }
  const buffer = await response.arrayBuffer();
  return URL.createObjectURL(new Blob([buffer], { type: mimeType }));
}

/**
 * Ensure FFmpeg.wasm is loaded and ready. Returns the shared instance.
 * @param {function} onStatus - Status message callback
 * @returns {Promise<FFmpeg>}
 */
async function ensureFFmpeg(onStatus) {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    if (onStatus) onStatus('Loading video converter...');

    await loadScript(`${CDN}/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js`);

    if (!window.FFmpegWASM) throw new Error('FFmpeg library failed to initialize. Please reload the page.');
    const { FFmpeg } = window.FFmpegWASM;
    const ffmpeg = new FFmpeg();

    if (onStatus) onStatus('Downloading codec (~10MB compressed, cached after first use)...');

    // Only the worker script has to be same-origin. importScripts() may fetch
    // cross-origin, so the core and wasm stay on the CDN and keep their cache.
    const classWorkerURL = await toBlobURL(
      `${CDN}/@ffmpeg/ffmpeg@0.12.10/dist/umd/814.ffmpeg.js`, 'text/javascript');

    // The blob worker is a module worker, where importScripts does not exist,
    // so FFmpeg falls back to import() and reads a default export. The UMD
    // build has none; the ESM build does.
    await ffmpeg.load({
      coreURL: `${CDN}/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js`,
      wasmURL: `${CDN}/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm`,
      classWorkerURL,
    });

    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await loadingPromise;
  } catch (e) {
    loadingPromise = null;
    throw e;
  }
}

// Every engine drives this one instance through fixed filenames (input.<ext>,
// output.<ext>) and attaches its own 'progress' listener to it, so two
// transactions in flight at once overwrite each other's files, delete files the
// other still needs, and cross-wire their progress bars. The unit that has to
// be exclusive is the whole write/exec/read/cleanup sequence, not any single
// call, so engines hand the entire transaction to withFFmpeg.
let ffmpegChain = Promise.resolve();

/**
 * Run an FFmpeg transaction with exclusive access to the shared instance.
 * @param {function(FFmpeg): Promise<T>} task - Receives the loaded instance.
 * @param {function} [onStatus] - Status message callback, forwarded to the load.
 * @returns {Promise<T>}
 */
export function withFFmpeg(task, onStatus) {
  const run = async () => task(await ensureFFmpeg(onStatus));
  // then(run, run) queues behind the previous transaction whether it resolved
  // or rejected; the chain is then normalized so one failure can neither
  // reject every later caller nor leave the queue stalled.
  const result = ffmpegChain.then(run, run);
  ffmpegChain = result.then(() => {}, () => {});
  return result;
}
