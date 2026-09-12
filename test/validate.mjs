import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import http from 'node:http';
import { cssVersion, htmlFiles } from '../scripts/css-version.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const BASE = 'http://localhost:3987';

const PAGES = [
  '/', '/heic-to-jpg', '/heic-to-png', '/heic-to-webp', '/heic-to-pdf',
  '/webp-to-jpg', '/webp-to-png', '/webp-to-pdf',
  '/png-to-jpg', '/jpg-to-png', '/jpg-to-webp', '/png-to-webp',
  '/compress', '/jpg-to-pdf', '/png-to-pdf',
  '/pdf-to-jpg', '/pdf-to-png', '/merge-pdf', '/video-to-gif',
  '/svg-to-jpg', '/svg-to-png', '/svg-to-webp', '/svg-to-pdf',
  '/bmp-to-jpg', '/bmp-to-png', '/bmp-to-webp', '/bmp-to-pdf',
  '/gif-to-jpg', '/gif-to-png', '/gif-to-webp', '/gif-to-pdf',
  '/jpg-to-gif', '/png-to-gif', '/webp-to-gif',
  '/avif-to-jpg', '/avif-to-png', '/avif-to-webp', '/avif-to-pdf',
  '/ico-to-jpg', '/ico-to-png', '/ico-to-webp', '/ico-to-pdf',
  '/tiff-to-jpg', '/tiff-to-png', '/tiff-to-webp', '/tiff-to-pdf',
  // High-value image tools
  '/background-remover', '/image-to-text', '/png-to-ico',
  '/mp3-to-wav', '/wav-to-mp3', '/ogg-to-wav', '/ogg-to-mp3',
  '/flac-to-wav', '/flac-to-mp3', '/m4a-to-wav', '/m4a-to-mp3',
  '/aac-to-wav', '/aac-to-mp3',
  '/epub-to-txt', '/epub-to-pdf', '/rtf-to-txt', '/rtf-to-pdf',
  '/docx-to-txt', '/docx-to-pdf',
  // HTML document conversion
  '/html-to-pdf',
  '/otf-to-ttf', '/woff-to-ttf', '/ttf-to-otf', '/woff-to-otf',
  '/ttf-to-woff', '/otf-to-woff',
  '/extract-zip', '/create-zip',
  '/split-pdf', '/resize-image', '/strip-exif', '/images-to-gif',
  '/mov-to-mp4', '/avi-to-mp4', '/mkv-to-mp4', '/webm-to-mp4', '/mp4-to-webm',
  '/compress-video',
  '/image-metadata',
  // Video conversions
  '/mp4-to-avi', '/mp4-to-mkv', '/mp4-to-mov',
  '/webm-to-avi', '/webm-to-mkv', '/webm-to-mov',
  '/mov-to-webm', '/mov-to-avi', '/mov-to-mkv',
  '/avi-to-webm', '/avi-to-mov', '/avi-to-mkv',
  '/mkv-to-webm', '/mkv-to-avi', '/mkv-to-mov',
  // Video-to-audio
  '/mp4-to-mp3', '/mp4-to-wav',
  '/mov-to-mp3', '/mov-to-wav',
  '/webm-to-mp3', '/webm-to-wav',
  '/avi-to-mp3', '/avi-to-wav',
  '/mkv-to-mp3', '/mkv-to-wav',
  // Video-to-GIF (format-specific)
  '/mp4-to-gif', '/webm-to-gif', '/mov-to-gif', '/avi-to-gif', '/mkv-to-gif',
  // GIF-to-Video
  '/gif-to-mp4', '/gif-to-webm', '/gif-to-mov', '/gif-to-avi', '/gif-to-mkv',
  // Audio conversions
  '/mp3-to-ogg', '/wav-to-ogg', '/flac-to-ogg', '/m4a-to-ogg', '/aac-to-ogg',
  '/mp3-to-flac', '/wav-to-flac', '/ogg-to-flac', '/m4a-to-flac', '/aac-to-flac',
  '/mp3-to-m4a', '/wav-to-m4a', '/ogg-to-m4a', '/flac-to-m4a', '/aac-to-m4a',
  '/mp3-to-aac', '/wav-to-aac', '/ogg-to-aac', '/flac-to-aac', '/m4a-to-aac',
  // MOBI documents
  '/mobi-to-txt', '/mobi-to-pdf',
  '/compress-audio',
  '/video-metadata',
  '/video-speed',
  '/pdf-ocr',
  // PDF page/text/compression tools
  '/delete-pdf-pages', '/extract-pdf-pages', '/reorder-pdf-pages',
  '/rotate-pdf', '/pdf-to-text', '/compress-pdf',
  '/about', '/privacy'
];

let passed = 0;
let failed = 0;

function ok(test, msg) {
  if (test) { passed++; }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

function fetch(url) {
  return new Promise((res, rej) => {
    http.get(url, r => {
      let body = '';
      r.on('data', c => body += c);
      r.on('end', () => res({ status: r.statusCode, body, headers: r.headers }));
    }).on('error', rej);
  });
}

function meta(html, property) {
  const re = new RegExp(`<meta\\s+(?:property|name)=["']${property}["']\\s+content=["']([^"']+)["']`, 'i');
  const m = html.match(re);
  if (m) return m[1];
  const re2 = new RegExp(`<meta\\s+content=["']([^"']+)["']\\s+(?:property|name)=["']${property}["']`, 'i');
  const m2 = html.match(re2);
  return m2 ? m2[1] : null;
}

function startServer() {
  return new Promise((res, rej) => {
    const proc = spawn('npx', ['serve', '.', '-p', '3987', '-s'], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe']
    });
    let ready = false;
    const check = () => {
      fetch(`${BASE}/`).then(() => {
        if (!ready) { ready = true; res(proc); }
      }).catch(() => setTimeout(check, 200));
    };
    setTimeout(check, 500);
    setTimeout(() => { if (!ready) rej(new Error('Server failed to start')); }, 15000);
  });
}

async function validatePage(path) {
  const label = path === '/' ? 'index' : path.slice(1);
  console.log(`\n--- ${label} ---`);

  const { status, body: html } = await fetch(`${BASE}${path}`);
  ok(status === 200, `${label}: HTTP ${status} (expected 200)`);
  ok(html.includes('<!DOCTYPE html>') || html.includes('<!doctype html>'), `${label}: missing DOCTYPE`);
  ok(html.includes('<html'), `${label}: missing <html>`);
  ok(html.includes('</html>'), `${label}: missing </html>`);

  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  ok(titleMatch && titleMatch[1].trim().length > 0, `${label}: missing or empty <title>`);

  const desc = meta(html, 'description');
  ok(desc && desc.length > 0, `${label}: missing meta description`);

  ok(meta(html, 'og:title'), `${label}: missing og:title`);
  ok(meta(html, 'og:description'), `${label}: missing og:description`);
  ok(meta(html, 'og:type'), `${label}: missing og:type`);
  ok(meta(html, 'og:url'), `${label}: missing og:url`);
  ok(meta(html, 'og:image'), `${label}: missing og:image`);

  ok(meta(html, 'twitter:card'), `${label}: missing twitter:card`);
  ok(meta(html, 'twitter:title'), `${label}: missing twitter:title`);
  ok(meta(html, 'twitter:description'), `${label}: missing twitter:description`);
  ok(meta(html, 'twitter:image'), `${label}: missing twitter:image`);

  const canonMatch = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/);
  ok(canonMatch, `${label}: missing canonical link`);
  if (canonMatch) {
    ok(canonMatch[1].startsWith('https://irisfiles.com'), `${label}: canonical doesn't start with https://irisfiles.com`);
  }

  ok(html.includes('href="/favicon.png"'), `${label}: missing favicon link`);

  const ldMatch = html.match(/<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/);
  if (path === '/about' || path === '/privacy') {
    // about/privacy pages: no JSON-LD required (but ok if present)
  } else {
    ok(ldMatch, `${label}: missing JSON-LD`);
    if (ldMatch) {
      try {
        const ld = JSON.parse(ldMatch[1]);
        ok(Array.isArray(ld) && ld.length === 2, `${label}: JSON-LD should be array of 2`);
        const types = ld.map(e => e['@type']);
        ok(types.includes('WebApplication'), `${label}: JSON-LD missing WebApplication`);
        ok(types.includes('FAQPage'), `${label}: JSON-LD missing FAQPage`);
      } catch (e) {
        ok(false, `${label}: JSON-LD parse error: ${e.message}`);
      }
    }
  }

  const hrefRe = /href="(\/[^"#]*)"/g;
  let m;
  while ((m = hrefRe.exec(html)) !== null) {
    const linkPath = m[1];
    if (linkPath.includes('.')) {
      ok(existsSync(join(ROOT, linkPath)), `${label}: broken asset link ${linkPath}`);
    } else {
      const filePath = linkPath === '/' ? 'index.html' : `${linkPath.slice(1)}.html`;
      ok(existsSync(join(ROOT, filePath)), `${label}: broken page link ${linkPath} (looked for ${filePath})`);
    }
  }

  const scriptRe = /<script[^>]+src="([^"]+)"/g;
  while ((m = scriptRe.exec(html)) !== null) {
    const src = m[1];
    if (src.startsWith('http://') || src.startsWith('https://')) continue;
    ok(existsSync(join(ROOT, src)), `${label}: missing script ${src}`);
  }
}

async function globalChecks() {
  console.log('\n=== GLOBAL CHECKS ===');

  const { status: smStatus, body: sitemap } = await fetch(`${BASE}/sitemap.xml`);
  ok(smStatus === 200, 'sitemap.xml: not found');
  const locRe = /<loc>([^<]+)<\/loc>/g;
  const urls = [];
  let m;
  while ((m = locRe.exec(sitemap)) !== null) urls.push(m[1]);
  ok(urls.length === PAGES.length, `sitemap.xml: has ${urls.length} URLs (expected ${PAGES.length})`);
  const sitemapPaths = new Set(urls.map(url => url.replace('https://irisfiles.com', '') || '/'));
  for (const page of PAGES) {
    ok(sitemapPaths.has(page), `sitemap.xml: missing registered page ${page}`);
  }

  for (const url of urls) {
    const path = url.replace('https://irisfiles.com', '');
    const filePath = (path === '' || path === '/') ? 'index.html' : `${path.replace(/^\//, '')}.html`;
    ok(existsSync(join(ROOT, filePath)), `sitemap.xml: ${url} has no corresponding file (${filePath})`);
  }

  const { status: rbStatus, body: robots } = await fetch(`${BASE}/robots.txt`);
  ok(rbStatus === 200, 'robots.txt: not found');
  ok(robots.includes('Allow: /'), 'robots.txt: missing Allow: /');
  ok(robots.toLowerCase().includes('sitemap:'), 'robots.txt: missing Sitemap directive');

  const expectedCssVersion = cssVersion();
  const shim = readFileSync(join(ROOT, 'css/style.css'), 'utf8');
  for (const [, imported, version] of shim.matchAll(/@import url\('\.\/([a-z-]+\.css)\?v=([^']*)'\)/g)) {
    ok(version === expectedCssVersion,
      `css/style.css: @import ${imported} is ?v=${version}, expected ?v=${expectedCssVersion} (run: node scripts/css-version.mjs --write)`);
  }
  const stalePages = htmlFiles().filter(file =>
    !readFileSync(join(ROOT, file), 'utf8').includes(`css/style.css?v=${expectedCssVersion}`));
  ok(stalePages.length === 0,
    `${stalePages.length} page(s) link a stale stylesheet version, e.g. ${stalePages[0]} (run: node scripts/css-version.mjs --write)`);

  // Sheets linked directly rather than through the shim are served with the same
  // max-age, so an unversioned one is invisible to returning visitors for hours.
  const unversionedLinks = [];
  for (const file of htmlFiles()) {
    const src = readFileSync(join(ROOT, file), 'utf8');
    for (const [match, , version] of src.matchAll(/href="css\/([a-z-]+\.css)(?:\?v=([^"]*))?"/g)) {
      if (version !== expectedCssVersion) unversionedLinks.push(`${file}: ${match}`);
    }
  }
  ok(unversionedLinks.length === 0,
    `${unversionedLinks.length} stylesheet link(s) missing the current ?v=, e.g. ${unversionedLinks[0]} (run: node scripts/css-version.mjs --write)`);

  const injectedHref = readFileSync(join(ROOT, 'js/file-focus.js'), 'utf8')
    .match(/const CSS_HREF = '([^']+)'/)?.[1];
  ok(injectedHref?.endsWith(`?v=${expectedCssVersion}`),
    `js/file-focus.js injects ${injectedHref}, expected ?v=${expectedCssVersion} (run: node scripts/css-version.mjs --write)`);

  const vercelJson = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  const cspHeader = vercelJson.headers
    .find(h => h.source === '/(.*)')
    ?.headers.find(h => h.key === 'Content-Security-Policy');
  ok(cspHeader, 'vercel.json: missing CSP header');
  if (cspHeader) {
    const csp = cspHeader.value;
    ok(csp.includes('worker-src') && csp.includes('blob:'), 'vercel.json CSP: missing worker-src blob:');
    ok(csp.includes('connect-src') && csp.includes('cdn.jsdelivr.net'), 'vercel.json CSP: missing connect-src cdn.jsdelivr.net');
    ok(csp.includes('img-src') && csp.includes('blob:') && csp.includes('data:'), 'vercel.json CSP: missing img-src blob: data:');
    ok(csp.includes("'unsafe-inline'"), 'vercel.json CSP: missing unsafe-inline in style-src');
  }

  const { status: fvStatus } = await fetch(`${BASE}/favicon.png`);
  ok(fvStatus === 200, 'favicon.png: not served (status ' + fvStatus + ')');

  const { status: ogStatus } = await fetch(`${BASE}/img/og-default.png`);
  ok(ogStatus === 200, 'img/og-default.png: not served (status ' + ogStatus + ')');
}

async function main() {
  console.log('Starting local server...');
  const server = await startServer();
  console.log('Server ready on port 3987');

  try {
    for (const page of PAGES) {
      await validatePage(page);
    }
    await globalChecks();
  } finally {
    server.kill('SIGTERM');
  }

  console.log('\n========================================');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('========================================');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
