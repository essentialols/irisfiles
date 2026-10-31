/**
 * Spike: does the IrisFiles converter work inside an MCP Apps host sandbox?
 *
 * Runs the built view in a double-iframe host (as in the reference host) under
 * two Content Security Policies:
 *   reference  the CSP of ext-apps/examples/basic-host (allows 'unsafe-eval', blob:)
 *   strict     the CSP the 2026-01-26 spec tells hosts to build (no WebAssembly, no blob: workers)
 * and with/without the host offering ui/download-file.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  ({ chromium } = createRequire(`${execSync('npm root -g').toString().trim()}/`)('playwright'));
}

const here = new URL('.', import.meta.url);
const fixtures = new URL('../../test/fixtures/', import.meta.url);

const CSP = {
  // ext-apps/examples/basic-host/serve.ts buildCspHeader() with no declared domains
  reference: [
    "default-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:",
    "style-src 'self' 'unsafe-inline' blob: data:",
    "img-src 'self' data: blob:", "font-src 'self' data: blob:", "media-src 'self' data: blob:",
    "connect-src 'self'", "worker-src 'self' blob:", "frame-src 'none'", "object-src 'none'", "base-uri 'none'",
  ].join('; '),
  // specification/2026-01-26/apps.mdx "CSP Construction from Metadata" with no declared domains
  strict: [
    "default-src 'none'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'",
    "connect-src 'self'", "img-src 'self' data:", "font-src 'self'", "media-src 'self' data:",
    "frame-src 'none'", "object-src 'none'", "base-uri 'self'",
  ].join('; '),
};

const hostJs = (await build({
  entryPoints: [new URL('host/host.js', here).pathname], bundle: true, format: 'esm', write: false, target: 'es2022',
})).outputFiles[0].text;
const appHtml = await readFile(new URL('../dist/irisfiles-app.html', here), 'utf8');
const sandboxHtml = await readFile(new URL('host/sandbox.html', here), 'utf8');

const listen = handler => new Promise(r => { const s = http.createServer(handler).listen(0, () => r(s)); });
const sandboxServer = await listen((req, res) => {
  const mode = new URL(req.url, 'http://x').searchParams.get('mode');
  res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': CSP[mode] || CSP.strict });
  res.end(sandboxHtml);
});
const sandboxOrigin = `http://localhost:${sandboxServer.address().port}`;
const hostServer = await listen((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/app.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(appHtml); return; }
  if (path === '/host.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(hostJs); return; }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!DOCTYPE html><meta charset="utf-8"><body><script type="module" src="/host.js"></script>');
});
const hostOrigin = `http://127.0.0.1:${hostServer.address().port}`; // different origin from the sandbox

const browser = await chromium.launch();
const rows = [];

async function openHost(mode, download) {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  let nativeDownloads = 0;
  page.on('download', () => { nativeDownloads += 1; });
  await page.goto(`${hostOrigin}/?mode=${mode}&download=${download ? 1 : 0}&sandbox=${encodeURIComponent(sandboxOrigin)}`);
  await page.waitForFunction(() => window.__host?.ready, null, { timeout: 30000 });
  let view;
  await expectSoon(async () => {
    for (const f of page.frames()) {
      if (await f.evaluate(() => Boolean(window.__iris?.connected)).catch(() => false)) { view = f; return true; }
    }
    return false;
  });
  await view.waitForFunction(() => window.__iris.probeResult, null, { timeout: 10000 });
  return { page, view, consoleErrors, nativeDownloads: () => nativeDownloads };
}

async function expectSoon(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 200)); }
  throw new Error('timed out');
}

async function runConversion(view, files, target) {
  await view.locator('#clear').click();
  await view.locator('#file-input').setInputFiles(files.map(f => new URL(f, fixtures).pathname));
  await view.locator('#target').selectOption(target);
  await view.locator('#convert').click();
  const finished = await view.waitForFunction(() => /Done|Could not/.test(document.getElementById('status').textContent), null, { timeout: 60000 })
    .then(() => true, () => false);
  if (!finished) {
    return view.evaluate(() => ({ status: `timed out: "${document.getElementById('status').textContent}"`, results: [] }));
  }
  return view.evaluate(() => ({
    status: document.getElementById('status').textContent,
    results: window.__iris.state.results.map(r => ({ name: r.name, size: r.blob.size })),
  }));
}

const CASES = [
  ['PNG → JPG (canvas)', ['sample.png'], 'jpg'],
  ['HEIC → JPG (WebAssembly)', ['sample.heic'], 'jpg'],
  ['Merge PDF (pdf-lib, JS)', ['multi-page.pdf', 'multi-page.pdf'], 'merge-pdf'],
  ['ZIP (fflate, JS)', ['sample.png', 'sample.jpg'], 'zip'],
];

for (const mode of ['reference', 'strict']) {
  const { page, view, consoleErrors, nativeDownloads } = await openHost(mode, true);
  const probe = await view.evaluate(() => window.__iris.probeResult);
  rows.push([mode, 'WebAssembly compiles', probe.wasm ? 'yes' : `no (${(probe.wasmError || '').slice(0, 60)})`]);
  rows.push([mode, 'blob: Web Worker (FFmpeg.wasm needs this)', probe.blobWorker ? 'yes' : 'no']);
  rows.push([mode, 'canvas encodes images', probe.canvasEncode ? 'yes' : 'no']);

  for (const [label, files, target] of CASES) {
    const r = await runConversion(view, files, target);
    console.error(`[${mode}] ${label}: ${r.status}`);
    rows.push([mode, label, r.results.length ? `yes: ${r.results.map(x => `${x.name} ${x.size}B`).join(', ')}` : `no: ${r.status}`]);
  }

  // Save via the host (ui/download-file) after a JPG conversion
  await runConversion(view, ['sample.png'], 'jpg');
  await view.locator('#results button').first().click();
  await expectSoon(() => page.evaluate(() => window.__host.downloads.length > 0));
  const dl = await page.evaluate(() => window.__host.downloads[0][0]);
  rows.push([mode, 'Save through host (ui/download-file)', dl.head.startsWith('/9j/') ? `yes: ${decodeURIComponent(dl.uri)}` : 'no']);

  // Direct <a download> from inside the sandbox (no allow-downloads)
  const before = nativeDownloads();
  await view.evaluate(() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['x'])); a.download = 'x.txt'; document.body.appendChild(a); a.click(); });
  await new Promise(r => setTimeout(r, 1500));
  rows.push([mode, 'Direct <a download> from the sandbox', nativeDownloads() > before ? 'yes' : 'no (blocked)']);

  // What the model is told
  const ctx = await page.evaluate(() => window.__host.modelContext.map(p => JSON.stringify(p)));
  const biggest = Math.max(...ctx.map(s => s.length));
  rows.push([mode, 'Shared with the model', `${ctx.length} summaries, largest ${biggest} chars, no file data: ${ctx.every(s => !/base64|data_/.test(s)) ? 'yes' : 'NO'}`]);
  console.error(`[${mode}] console errors:`, consoleErrors.slice(0, 5));
  if (consoleErrors.length) rows.push([mode, 'console errors', consoleErrors.slice(0, 2).join(' | ').slice(0, 160)]);
  await page.close();
}

// Host without ui/download-file (e.g. one implementing only the stable spec)
{
  const { page, view } = await openHost('reference', false);
  await runConversion(view, ['sample.png'], 'jpg');
  await view.locator('#results button').first().click();
  await new Promise(r => setTimeout(r, 500));
  const label = await view.locator('#results button').first().textContent();
  rows.push(['no-download host', 'Save result', label]);
  await page.close();
}

await browser.close();
hostServer.close(); sandboxServer.close();

const width = Math.max(...rows.map(r => r[1].length));
for (const [mode, what, result] of rows) console.log(`${mode.padEnd(16)} ${what.padEnd(width)}  ${result}`);

// Assertions that hold under every host: the JS-only tools and host-mediated save.
const get = (m, w) => rows.find(r => r[0] === m && r[1] === w)?.[2] || '';
for (const m of ['reference', 'strict']) {
  assert.match(get(m, 'PNG → JPG (canvas)'), /^yes/);
  assert.match(get(m, 'Merge PDF (pdf-lib, JS)'), /^yes/);
  assert.match(get(m, 'ZIP (fflate, JS)'), /^yes/);
  assert.match(get(m, 'Save through host (ui/download-file)'), /^yes/);
}
assert.match(get('reference', 'HEIC → JPG (WebAssembly)'), /^yes/);
// Under the spec's strict CSP, HEIC must fail fast and say why, not hang.
assert.match(get('strict', 'HEIC → JPG (WebAssembly)'), /blocks WebAssembly/);
console.log('\nsandbox runtime spike OK');
