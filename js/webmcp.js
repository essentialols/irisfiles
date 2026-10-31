/**
 * IrisFiles - page tools for in-browser AI agents (WebMCP).
 *
 * When the browser exposes a model context (WebMCP: `document.modelContext`,
 * formerly `navigator.modelContext`), every page registers tools an agent can
 * call instead of clicking through the UI:
 *
 *   find_tool      search the catalog of tool pages (every page)
 *   get_page_info  what this page does, what it accepts, its FAQ (every page)
 *   convert_files  run this page's tool on files the agent passes in (tool pages)
 *
 * convert_files hands the bytes to the page's own pipeline, exactly as if the
 * person had dropped the files. Conversion happens in the browser tab, not on a
 * server; the outputs go only to the agent that called the tool, from memory.
 * In browsers without WebMCP this module does nothing.
 *
 * It drives the existing UI rather than the engines so that all ~150 pages are
 * covered without per-page wiring, and so the person sees the same file list,
 * progress and errors they would see after dropping the files themselves.
 */

const MAX_RETURN_BYTES = 25 * 1024 * 1024; // base64 inflates ~33%; keep replies sane
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // video tools run FFmpeg.wasm and can be slow
const START_BUTTONS = ['#action-btn', '#convert-btn', '#resize-btn'];
const ZIP_BUTTONS = ['#download-all', '#dl-all-zip', '#dl-all', '#dl-zip'];
// First group with visible buttons wins, so pages offering several renditions
// of the same output (background remover, PDF single + per-page) return one set.
const DOWNLOAD_GROUPS = [
  '.file-item.done .btn-download, .file-item .dl',
  '#pdf-results .dl-btn, #archive-results .dl-btn, #font-results .dl-btn',
  '#dl-single',
  '#pdf-result-download',
  '#download-text',
  '#dl-doc',
  '#ocr-download',
  '#html-pdf-download',
  '#download-transparent',
  '#dl-gif',
  '.btn-download',
];
const ERROR_SELECTORS = [
  '.file-item__status.error',
  '.notice[data-kind="error"]',
  '#pdf-results .notice',
  '#archive-results .notice',
  '#font-results .notice',
  '#gif-result .notice',
  // Tool-level failure banners such as #pdf-tools-notice ("Failed to load...").
  // #cf-notice is excluded: it carries batch warnings, not failures.
  '.notice[id$="-notice"]:not(#cf-notice)',
].join(', ');
// Pages check File.type, and agents often send only a name.
const MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff',
  ico: 'image/x-icon', heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf',
  mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo', mkv: 'video/x-matroska', webm: 'video/webm',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac',
  epub: 'application/epub+zip', rtf: 'application/rtf', mobi: 'application/x-mobipocket-ebook',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', zip: 'application/zip', html: 'text/html', htm: 'text/html',
  txt: 'text/plain',
};
const FORMAT_WORDS = new Set([
  'heic', 'jpg', 'png', 'webp', 'gif', 'pdf', 'svg', 'bmp', 'avif', 'tiff', 'ico',
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac',
  'epub', 'rtf', 'docx', 'mobi', 'txt', 'ttf', 'otf', 'woff', 'zip', 'html', 'exif', 'ocr',
]);
const FILLER = new Set(['convert', 'converter', 'file', 'files', 'to', 'into', 'a', 'an', 'the', 'my']);

export function getModelContext() {
  if (typeof document !== 'undefined' && document.modelContext) return document.modelContext;
  if (typeof navigator !== 'undefined' && navigator.modelContext) return navigator.modelContext;
  return null;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Agent-supplied numbers may be strings, null or junk: fall back instead of NaN.
// (parseFloat, not Number: Number('') and Number(null) are 0.)
const finiteOr = (value, fallback) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
};
const json = value => JSON.stringify(value);

function isShown(el) {
  if (!el) return false;
  if (typeof el.checkVisibility === 'function') return el.checkVisibility();
  return el.offsetParent !== null;
}

function isVisible(el) {
  return Boolean(el) && !el.disabled && isShown(el);
}

function slugTitle(slug) {
  return slug.split('-').map(word => {
    if (FORMAT_WORDS.has(word)) return word.toUpperCase();
    if (word === 'to') return 'to';
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/\bjpeg\b/g, 'jpg').replace(/\btif\b/g, 'tiff')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

let catalogPromise = null;
async function loadCatalog() {
  if (!catalogPromise) {
    // A failed fetch is not cached: the next call retries.
    const attempt = fetch('/sitemap.xml')
      .then(r => {
        if (!r.ok) throw new Error(`sitemap.xml: HTTP ${r.status}`);
        return r.text();
      })
      .then(xml => Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g), m => new URL(m[1]).pathname)
        .filter(path => path !== '/' && !['/about', '/privacy', '/verify-local-file-conversion'].includes(path))
        .map(path => ({ name: slugTitle(path.slice(1)), url: new URL(path, location.origin).href, slug: path.slice(1) })));
    catalogPromise = attempt;
    attempt.catch(() => { if (catalogPromise === attempt) catalogPromise = null; });
  }
  try {
    return await catalogPromise;
  } catch {
    return [];
  }
}

export async function findTool({ query = '', limit = 10 } = {}) {
  const max = Math.max(1, Math.min(50, Math.floor(finiteOr(limit, 10))));
  const catalog = await loadCatalog();
  const terms = normalize(query).split(' ').filter(t => t && !FILLER.has(t));
  const directional = normalize(query).match(/^(?:convert )?(\S+) (?:to|into) (\S+)$/);
  const scored = catalog.map(tool => {
    const hay = normalize(tool.slug);
    let score = terms.filter(t => hay.includes(t)).length;
    if (directional && tool.slug === `${directional[1]}-to-${directional[2]}`) score += 10;
    return { tool, score };
  }).filter(({ score }) => terms.length === 0 || score === terms.length || score >= 10);
  scored.sort((a, b) => b.score - a.score || a.tool.slug.length - b.tool.slug.length);
  const tools = scored.slice(0, max).map(({ tool }) => ({ name: tool.name, url: tool.url }));
  return {
    query,
    count: tools.length,
    tools,
    note: tools.length
      ? 'Open a tool URL, then call convert_files on that page. Files are converted in the browser, not on a server.'
      : 'No matching tool. Try a format pair such as "heic to jpg" or a task such as "merge pdf".',
  };
}

export function pageInfo() {
  const input = document.getElementById('file-input');
  const slider = document.getElementById('quality-slider');
  const faq = Array.from(document.querySelectorAll('.faq-item')).map(item => ({
    question: item.querySelector('.faq-question')?.textContent.trim() || '',
    answer: item.querySelector('.faq-answer')?.textContent.trim().replace(/\s+/g, ' ') || '',
  })).filter(q => q.question);
  return {
    title: document.querySelector('h1')?.textContent.trim() || document.title,
    url: location.href,
    is_tool_page: Boolean(input),
    accepts: input?.getAttribute('accept') || null,
    multiple_files: Boolean(input?.multiple),
    quality_control: slider ? { min: Number(slider.min), max: Number(slider.max), current: Number(slider.value) } : null,
    privacy: 'Files are converted inside this browser tab; there is no server-side processing. Outputs of convert_files go only to the agent that calls it.',
    related_tools: Array.from(document.querySelectorAll('.related-tools a')).map(a => ({ name: a.textContent.trim(), url: a.href })),
    faq,
  };
}

function base64ToBytes(b64) {
  const clean = String(b64 || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

/**
 * Every tool saves its output through an <a download href="blob:..."> click
 * (converter.js downloadBlob and its copies). Clicks the module triggers itself
 * are diverted into memory instead of the person's Downloads folder; every other
 * click, including the person's own Download clicks while a call is running, goes
 * through untouched.
 *
 * Armed means: inside one of our own button clicks, or after one whose download
 * has not arrived yet (some buttons build their blob asynchronously). A trusted
 * click (the person acting) disarms immediately, in the capture phase, so their
 * click is never swallowed even if an own click is still pending.
 */
function startDownloadCapture() {
  const captured = [];
  // The site's CSP (connect-src) forbids fetch() of blob: URLs, so the Blob is
  // remembered when the page creates its object URL rather than read back.
  const blobsByUrl = new Map();
  let inOwnClick = false;
  let pending = 0;
  const armed = () => inOwnClick || pending > 0;
  const originalCreate = URL.createObjectURL;
  URL.createObjectURL = function captureCreate(obj) {
    const url = originalCreate.call(URL, obj);
    if (armed() && obj instanceof Blob) blobsByUrl.set(url, obj);
    return url;
  };
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function captureClick(...args) {
    const blob = armed() && this.hasAttribute('download') ? blobsByUrl.get(this.href) : null;
    if (blob) {
      blobsByUrl.delete(this.href);
      pending = Math.max(0, pending - 1);
      captured.push({ name: this.getAttribute('download') || 'output', blob });
      return undefined;
    }
    return originalClick.apply(this, args);
  };
  const onPersonClick = event => { if (event.isTrusted) pending = 0; };
  document.addEventListener('click', onPersonClick, true);
  return {
    captured,
    click(button) {
      inOwnClick = true;
      pending += 1;
      try { button.click(); } finally { inOwnClick = false; }
    },
    stop() {
      HTMLAnchorElement.prototype.click = originalClick;
      URL.createObjectURL = originalCreate;
      document.removeEventListener('click', onPersonClick, true);
    },
  };
}

/**
 * Sets the slider value for this call only. No 'input' event: ui.js's handler
 * saves the value to localStorage and re-queues every finished file on the page,
 * which would clobber the person's saved quality and re-run their earlier files.
 * Both ui.js and pdf-ui.js read slider.value when a conversion starts, so the
 * plain assignment is enough; the person's value is put back afterwards.
 */
function setQuality(percent) {
  const slider = document.getElementById('quality-slider');
  const wanted = parseFloat(percent);
  if (!slider || !Number.isFinite(wanted)) return { applied: null, restore() {} };
  const previous = slider.value;
  const min = finiteOr(slider.min, 10);
  const max = finiteOr(slider.max, 100);
  slider.value = String(Math.max(min, Math.min(max, Math.round(wanted))));
  return { applied: Number(slider.value), restore() { slider.value = previous; } };
}

// ctx.before: elements that existed before the call. ctx.rows: the .file-item
// rows this call's change event created (null when the page adds rows later or
// the call pressed a start button, then any new row counts). A row or button belonging to a row outside that set
// is the person's, never ours.
function newOnly(selector, ctx) {
  return Array.from(document.querySelectorAll(selector)).filter(el => {
    if (ctx.before.has(el)) return false;
    const row = el.closest('.file-item');
    return !row || !ctx.rows || ctx.rows.has(row);
  });
}

function errorsSince(ctx) {
  return newOnly(ERROR_SELECTORS, ctx)
    .filter(isVisible)
    .map(el => {
      const copy = el.cloneNode(true);
      copy.querySelectorAll('button').forEach(b => b.remove()); // drop "Dismiss"
      return copy.textContent.trim().replace(/\s+/g, ' ');
    })
    .filter(Boolean);
}

function findDownloadButtons(ctx) {
  for (const selector of DOWNLOAD_GROUPS) {
    const buttons = newOnly(selector, ctx)
      .filter(el => isVisible(el) && !ZIP_BUTTONS.some(z => el.matches(z)));
    if (buttons.length) return buttons;
  }
  // A "download all" bundle is only the answer when it is the only output
  // (create-zip's archive is #dl-zip).
  const bundle = newOnly(ZIP_BUTTONS.join(', '), ctx).find(isVisible);
  return bundle ? [bundle] : [];
}

function listItemsSettled(ctx) {
  const items = newOnly('.file-item', ctx);
  if (!items.length) return null; // not a list-style page
  return items.every(item => item.classList.contains('done') || item.classList.contains('failed')
    || item.querySelector('.file-item__status.error'));
}

function startButtons() {
  return START_BUTTONS.map(sel => document.querySelector(sel));
}

function busy() {
  // Panel tools disable their start button while working.
  return startButtons().some(btn => btn && btn.disabled && isShown(btn));
}

let running = false;

export async function convertFiles({ files = [], quality = null, include_data = true, timeout_seconds = null } = {}) {
  const input = document.getElementById('file-input');
  if (!input) return { ok: false, error: 'This page has no file tool. Use find_tool to get the URL of a tool page first.' };
  if (!Array.isArray(files) || files.length === 0) return { ok: false, error: 'Pass at least one file as { name, data_base64 }.' };
  if (!input.multiple && files.length > 1) return { ok: false, error: 'This tool takes one file at a time. Call convert_files once per file.' };
  if (running) return { ok: false, error: 'A conversion is already running on this page. Wait for it to finish.' };
  running = true;

  const ctx = {
    before: new Set(document.querySelectorAll(`.file-item, ${DOWNLOAD_GROUPS.join(', ')}, ${ERROR_SELECTORS}`)),
    rows: null,
  };
  // "Download all" buttons are persistent and bundle every finished file on the
  // page. One that was already showing holds the person's files, so it is never
  // ours; one that was hidden becomes ours when this call's files reveal it.
  document.querySelectorAll(ZIP_BUTTONS.join(', ')).forEach(el => { if (isShown(el)) ctx.before.add(el); });
  const capture = startDownloadCapture();
  const timeoutS = Math.max(5, Math.min(1800, finiteOr(timeout_seconds, DEFAULT_TIMEOUT_MS / 1000)));
  const timeoutMs = timeoutS * 1000;
  const deadline = Date.now() + timeoutMs;
  let slider = { applied: null, restore() {} };

  try {
    const fileObjects = files.map((f, i) => {
      if (!f || typeof f.data_base64 !== 'string') throw new Error(`files[${i}] needs data_base64`);
      const name = f.name || `file-${i + 1}`;
      const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
      return new File([base64ToBytes(f.data_base64)], name, { type: f.mime_type || MIME_BY_EXT[ext] || '' });
    });
    slider = setQuality(quality);

    const transfer = new DataTransfer();
    fileObjects.forEach(file => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // Ownership is fixed here: ui.js-style pages add their rows synchronously,
    // so anything that appears later in the list is not from this call.
    const ownRows = newOnly('.file-item', ctx);
    ctx.rows = ownRows.length ? new Set(ownRows) : null;

    // Tools that wait for a button: press it once it appears and is enabled.
    let started = false;
    const startBy = Date.now() + 15000;
    const noRowsBy = Date.now() + 5000;
    while (!started && Date.now() < startBy) {
      await sleep(250);
      const btn = startButtons().find(isVisible);
      if (btn) {
        capture.click(btn);
        started = true;
        // Button-started tools create their result rows (create-zip's archive
        // row) after the press, so the input-row ownership filter ends here.
        ctx.rows = null;
        break;
      }
      if (findDownloadButtons(ctx).length || errorsSince(ctx).length) break;
      // A shown but still disabled start button means the page is not ready yet.
      const startShown = startButtons().some(b => b && isShown(b));
      if (!startShown && listItemsSettled(ctx) !== null) break; // auto-converting page
      if (!startShown && !newOnly('.file-item', ctx).length && Date.now() > noRowsBy) {
        // E.g. the 50-file batch limit: ui.js shows a notice and adds no rows.
        const notice = document.getElementById('cf-notice')?.textContent.trim().replace(/\s+/g, ' ');
        return {
          ok: false,
          error: `The page did not accept the files${notice ? ` (${notice})` : ''}. `
            + 'Ask the person to clear the files already on the page, then try again.',
        };
      }
    }

    // Page editors (rotate, reorder, delete, extract) and images-to-gif keep
    // their button disabled until the person makes a choice convert_files
    // cannot express. Say so now instead of waiting out the full timeout.
    const blocked = startButtons().find(btn => btn && btn.disabled && isShown(btn));
    if (!started && blocked && listItemsSettled(ctx) === null
        && !findDownloadButtons(ctx).length && !errorsSince(ctx).length) {
      return {
        ok: false,
        error: `The files are loaded, but "${blocked.textContent.trim()}" stays disabled: this tool needs choices `
          + 'made on the page (for example which pages to rotate) or more input. Ask the person to finish it on the page.',
      };
    }

    // Wait for outputs or errors.
    let buttons = [];
    let errors = [];
    while (Date.now() < deadline) {
      await sleep(400);
      errors = errorsSince(ctx);
      // Button-started tools also list their inputs as .file-item rows that
      // never turn "done", so only auto-converting pages are judged by rows.
      const listSettled = started ? null : listItemsSettled(ctx);
      if (listSettled === false || busy()) continue;
      buttons = findDownloadButtons(ctx);
      if (listSettled === true || buttons.length || errors.length) {
        if (!buttons.length && !errors.length) continue;
        break;
      }
    }
    if (!buttons.length && !errors.length) {
      return { ok: false, error: `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the tool to finish.` };
    }

    for (const btn of buttons) capture.click(btn);
    // Some buttons build their blob on demand, asynchronously.
    const collectBy = Date.now() + 30000;
    let lastCount = -1;
    while (Date.now() < collectBy) {
      if (capture.captured.length >= buttons.length && capture.captured.length === lastCount) break;
      lastCount = capture.captured.length;
      await sleep(300);
    }

    let budget = include_data ? MAX_RETURN_BYTES : 0;
    const outputs = [];
    for (const { name, blob } of capture.captured) {
      const out = { name, size_bytes: blob.size, mime_type: blob.type || null };
      if (blob.size <= budget) {
        out.data_base64 = await blobToBase64(blob);
        budget -= blob.size;
      } else if (include_data) {
        out.note = 'Too large to return inline; the result is still in the page for the person to download.';
      }
      outputs.push(out);
    }
    return {
      ok: outputs.length > 0,
      tool: document.querySelector('h1')?.textContent.trim() || document.title,
      quality: slider.applied,
      outputs,
      errors,
      privacy: 'Converted in this browser tab, not on a server. The outputs above go only to the agent that called this tool.',
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  } finally {
    capture.stop();
    slider.restore();
    running = false;
  }
}

const TOOLS = [
  {
    name: 'find_tool',
    description: 'Search IrisFiles (private, in-browser file converter) for a tool page by format pair or task, e.g. "heic to jpg", "merge pdf", "mp4 to mp3", "compress video". Returns tool names and URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Formats or task, e.g. "png to webp" or "remove background".' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true },
    execute: args => findTool(args),
  },
  {
    name: 'get_page_info',
    description: 'Describe the current IrisFiles page: what it converts, accepted file types, whether it takes several files, its quality control, related tools, and its FAQ (limits and behaviour).',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    execute: () => pageInfo(),
  },
  {
    name: 'convert_files',
    description: 'Run this page\'s tool on the given files inside the browser (converted in this tab, not on a server) and return the outputs, as base64, to the calling agent only. Call get_page_info first to see accepted types. Video tools can take minutes.',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'File name including extension, e.g. "photo.heic".' },
              data_base64: { type: 'string', description: 'File contents, base64 encoded.' },
              mime_type: { type: 'string' },
            },
            required: ['name', 'data_base64'],
          },
        },
        quality: { type: 'integer', minimum: 10, maximum: 100, description: 'Image quality in percent, on pages with a quality slider.' },
        include_data: { type: 'boolean', default: true, description: 'Return output bytes (up to 25MB in total).' },
        timeout_seconds: { type: 'integer', minimum: 5, maximum: 1800 },
      },
      required: ['files'],
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: args => convertFiles(args),
  },
];

export function registerPageTools(modelContext = getModelContext()) {
  if (!modelContext || typeof modelContext.registerTool !== 'function') return null;
  const controller = new AbortController();
  const isToolPage = Boolean(document.getElementById('file-input'));
  const registered = [];
  for (const tool of TOOLS) {
    if (tool.name === 'convert_files' && !isToolPage) continue;
    const descriptor = { ...tool, execute: async args => json(await tool.execute(args || {})) };
    try {
      const result = modelContext.registerTool(descriptor, { signal: controller.signal });
      if (result && typeof result.catch === 'function') result.catch(err => console.warn('WebMCP registerTool failed:', tool.name, err));
      registered.push(tool.name);
    } catch (err) {
      console.warn('WebMCP registerTool failed:', tool.name, err);
    }
  }
  return { registered, controller };
}

registerPageTools();
