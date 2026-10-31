/**
 * IrisFiles MCP App view: runs inside the chat host's sandboxed iframe.
 *
 * The person drops files here; conversion happens in this iframe on their
 * device. Only a one-line summary (counts, target format and total sizes; never
 * file names or contents) is shared with the model, and results are handed back
 * through the host's download
 * mechanism (ui/download-file), because sandboxed iframes cannot download.
 */
import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import { heicTo } from 'heic-to/csp';
import { zipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';

const app = new App({ name: 'IrisFiles', version: '0.1.0' });
const $ = id => document.getElementById(id);
const state = { files: [], results: [] };
let generation = 0; // bumped on every drop, clear and convert; stale completions are dropped

// ---------- capability probes (also used by the spike test) ----------
const WASM_MODULE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]); // empty, valid module

async function probe() {
  const out = {};
  try { await WebAssembly.compile(WASM_MODULE); out.wasm = true; } catch (e) { out.wasm = false; out.wasmError = e.message; }
  try {
    const url = URL.createObjectURL(new Blob(['postMessage(1)'], { type: 'text/javascript' }));
    out.blobWorker = await new Promise(resolve => {
      let w;
      try { w = new Worker(url); } catch { resolve(false); return; }
      const t = setTimeout(() => resolve(false), 2000);
      w.onmessage = () => { clearTimeout(t); resolve(true); w.terminate(); };
      w.onerror = () => { clearTimeout(t); resolve(false); };
    });
  } catch { out.blobWorker = false; }
  try { const c = document.createElement('canvas'); c.width = c.height = 2; out.canvasEncode = Boolean(await new Promise(r => c.toBlob(r, 'image/jpeg'))); } catch { out.canvasEncode = false; }
  const caps = app.getHostCapabilities?.() || {};
  out.hostDownloadFile = Boolean(caps.downloadFile);
  out.hostOpenLinks = Boolean(caps.openLinks);
  return out;
}

// ---------- converters ----------
const TARGETS = {
  jpg: { label: 'JPG', mime: 'image/jpeg', ext: 'jpg' },
  png: { label: 'PNG', mime: 'image/png', ext: 'png' },
  webp: { label: 'WebP', mime: 'image/webp', ext: 'webp' },
  'merge-pdf': { label: 'Merge PDFs', mime: 'application/pdf', ext: 'pdf', all: true },
  zip: { label: 'ZIP archive', mime: 'application/zip', ext: 'zip', all: true },
};

const baseName = name => name.replace(/\.[^.]+$/, '');

// Make output names unique: a.jpg, then a (1).jpg, a (2).jpg. Comparison is
// case-insensitive because the person's file system usually is.
function uniqueName(name, used) {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  for (let i = 1; used.has(candidate.toLowerCase()); i += 1) candidate = `${stem} (${i})${ext}`;
  used.add(candidate.toLowerCase());
  return candidate;
}
const isHeic = f => /\.(heic|heif)$/i.test(f.name) || /hei[cf]/i.test(f.type);

async function toImage(file, target, quality) {
  let source = file;
  if (isHeic(file)) {
    // libheif is WebAssembly in a worker. Hosts that follow the spec's default
    // CSP block both, and heic-to then never settles, so check first.
    if (window.__iris.probeResult && !window.__iris.probeResult.wasm) {
      throw new Error('this chat app blocks WebAssembly, which HEIC decoding needs. Use irisfiles.com/heic-to-jpg instead; it is just as private.');
    }
    source = await Promise.race([
      heicTo({ blob: file, type: 'image/png' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('HEIC decoding did not start in this chat app. Use irisfiles.com/heic-to-jpg instead.')), 30000)),
    ]);
  }
  const bitmap = await createImageBitmap(source);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (target.mime === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.drawImage(bitmap, 0, 0);
  const blob = await new Promise(r => canvas.toBlob(r, target.mime, quality));
  if (!blob) throw new Error(`This browser cannot encode ${target.label}`);
  return { name: `${baseName(file.name)}.${target.ext}`, blob };
}

async function mergePdfs(files) {
  const out = await PDFDocument.create();
  for (const f of files) {
    const doc = await PDFDocument.load(await f.arrayBuffer());
    const pages = await out.copyPages(doc, doc.getPageIndices());
    pages.forEach(p => out.addPage(p));
  }
  return { name: 'merged.pdf', blob: new Blob([await out.save()], { type: 'application/pdf' }) };
}

async function zipFiles(files) {
  const input = {};
  const used = new Set();
  for (const f of files) input[uniqueName(f.name, used)] = new Uint8Array(await f.arrayBuffer());
  return { name: 'files.zip', blob: new Blob([zipSync(input, { level: 6 })], { type: 'application/zip' }) };
}

export async function convert(files, targetKey, quality = 0.92) {
  const target = TARGETS[targetKey];
  if (!target) throw new Error(`Unknown target ${targetKey}`);
  if (targetKey === 'merge-pdf') return [await mergePdfs(files)];
  if (targetKey === 'zip') return [await zipFiles(files)];
  const results = [];
  const used = new Set();
  for (const f of files) {
    const r = await toImage(f, target, quality);
    results.push({ ...r, name: uniqueName(r.name, used) });
  }
  return results;
}

// ---------- saving results ----------
async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function save(result) {
  if (app.getHostCapabilities?.()?.downloadFile) {
    const { isError } = await app.downloadFile({
      contents: [{
        type: 'resource',
        resource: { uri: `file:///${encodeURIComponent(result.name)}`, mimeType: result.blob.type, blob: await blobToBase64(result.blob) },
      }],
    });
    return isError ? 'host-declined' : 'host-download';
  }
  // No host download support: a sandboxed iframe without allow-downloads cannot
  // save files, so say so instead of failing silently.
  return 'unsupported';
}

// ---------- UI ----------
const fmt = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

function render() {
  $('file-list').innerHTML = state.files.map(f => `<li>${escapeHtml(f.name)} <span>${fmt(f.size)}</span></li>`).join('');
  $('convert').disabled = state.files.length === 0;
  $('results').innerHTML = '';
  state.results.forEach((r, i) => {
    const li = document.createElement('li');
    li.innerHTML = `${escapeHtml(r.name)} <span>${fmt(r.blob.size)}</span> `;
    const btn = document.createElement('button');
    btn.textContent = 'Save';
    btn.dataset.index = String(i);
    btn.onclick = async () => {
      const how = await save(r).catch(e => `error: ${e.message}`);
      btn.textContent = how === 'host-download' ? 'Saved' : how === 'unsupported' ? 'Saving not supported here' : how;
    };
    li.appendChild(btn);
    $('results').appendChild(li);
  });
}

function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Everything is held in this iframe's memory, and ui/download-file sends each
// result base64-encoded (+33%), so cap what one session takes on. The per-file
// cap matches irisfiles.com; the total keeps a batch well inside tab memory.
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

function addFiles(list) {
  generation += 1; // an in-flight conversion no longer matches the file list
  const skipped = [];
  let total = state.files.reduce((n, f) => n + f.size, 0);
  for (const f of Array.from(list)) {
    if (f.size > MAX_FILE_BYTES) { skipped.push(`${f.name} is over ${fmt(MAX_FILE_BYTES)}`); continue; }
    if (total + f.size > MAX_TOTAL_BYTES) { skipped.push(`${f.name} would take this batch over ${fmt(MAX_TOTAL_BYTES)}`); continue; }
    total += f.size;
    state.files.push(f);
  }
  state.results = [];
  $('status').textContent = skipped.length
    ? `Skipped: ${skipped.join('; ')}. For larger files use irisfiles.com, where nothing is sent through the chat app.`
    : '';
  render();
}

function wire() {
  $('file-input').addEventListener('change', e => addFiles(e.target.files));
  const drop = $('drop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });
  $('clear').onclick = () => { generation += 1; state.files = []; state.results = []; $('status').textContent = ''; render(); };
  $('convert').onclick = async () => {
    const mine = ++generation;
    const files = state.files.slice();
    const targetKey = $('target').value;
    $('status').textContent = 'Converting on your device…';
    $('convert').disabled = true;
    let results;
    let error;
    try { results = await convert(files, targetKey); } catch (e) { error = e; }
    if (mine !== generation) return; // files were dropped or cleared meanwhile: this result is stale
    if (error) {
      $('status').textContent = `Could not convert: ${error.message}`;
    } else {
      state.results = results;
      $('status').textContent = `Done. ${results.length} file(s) ready. Nothing was uploaded.`;
      // Tell the model what happened: counts, format and total sizes only. No names, no contents.
      const total = list => list.reduce((n, x) => n + (x.size ?? x.blob.size), 0);
      app.updateModelContext?.({
        content: [{ type: 'text', text: `IrisFiles converted ${files.length} file(s) to ${TARGETS[targetKey].label} on the user's device: ${results.length} output file(s), input ${fmt(total(files))}, output ${fmt(total(results))}. File names and contents were not shared.` }],
      }).catch(() => {});
    }
    render();
  };
}

// The tool's `target` argument preselects the output format. Handlers are
// registered before connect() so the host's first notifications are not missed.
function applyTarget(target) {
  if (typeof target === 'string' && Object.hasOwn(TARGETS, target)) $('target').value = target;
}
app.addEventListener('toolinput', params => applyTarget(params.arguments?.target));
app.addEventListener('toolresult', params => applyTarget(params.structuredContent?.target));

window.__iris = { probe, convert, save, state, app };

wire();
render();
app.connect(new PostMessageTransport(window.parent, window.parent))
  .then(async () => {
    window.__iris.connected = true;
    const p = await probe();
    window.__iris.probeResult = p;
    $('device').textContent = p.wasm ? '' : 'Note: this chat app blocks WebAssembly, so HEIC is unavailable here.';
  })
  .catch(e => { window.__iris.connectError = e.message; });
