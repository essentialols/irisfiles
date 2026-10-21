/**
 * HEIC conversion loader.
 * Lazily loads the heic-to CSP build (ES module, embedded WASM) on first use.
 * The default/IIFE build inlines its Emscripten glue into a blob worker whose
 * embind layer builds functions with `new Function`, which our CSP rejects for
 * lacking 'unsafe-eval'. The `dist/csp` build does the same work without it.
 * Primary: jsDelivr CDN (free, unlimited bandwidth, not counted against Vercel).
 * Fallback: local copy in wasm/heic/.
 * Runs on the main thread because heic-to needs Canvas/DOM access.
 */

const CDN_URL = 'https://cdn.jsdelivr.net/npm/heic-to@1.4.2/dist/csp/heic-to.js';
const LOCAL_URL = '/wasm/heic/heic-to.csp.js';

let heicToFn = null;
let loadPromise = null;

export function loadHeicTo() {
  if (heicToFn) return Promise.resolve(heicToFn);
  if (loadPromise) return loadPromise;

  // Dynamic import, not a <script> tag: the CSP build is an ES module with a
  // named `heicTo` export and sets no global.
  loadPromise = import(CDN_URL)
    .catch(() => import(LOCAL_URL))
    .then((mod) => {
      heicToFn = mod && mod.heicTo;
      if (!heicToFn) throw new Error('HEIC decoder not found after loading');
      return heicToFn;
    })
    .catch((err) => {
      loadPromise = null; // allow retry
      throw err;
    });

  return loadPromise;
}

/**
 * Convert a HEIC file using heic-to.
 * @param {File|Blob} file
 * @param {string} targetMime - e.g. 'image/jpeg'
 * @param {number} quality - 0-1
 * @returns {Promise<Blob>}
 */
export async function convertHeicFile(file, targetMime, quality) {
  const heicTo = await loadHeicTo();
  return heicTo({ blob: file, type: targetMime, quality });
}
