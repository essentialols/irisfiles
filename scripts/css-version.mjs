/**
 * Keep the stylesheet cache-buster tied to the stylesheet's actual contents.
 *
 * css/style.css is only an @import shim, so editing style-base.css or
 * theme-overhaul.css changes what a page renders without changing any URL a
 * browser has cached. That already shipped once: the redesign was live but
 * invisible to every returning visitor for four hours, which is exactly the
 * `max-age=14400` the stylesheets are served with.
 *
 * Sheets that are linked directly rather than imported through the shim, and
 * the one file-focus.js injects at runtime, have the same problem, so every
 * stylesheet is covered. The list is read from the directory rather than
 * written out, because the two sheets added most recently were both missed.
 *
 *   node scripts/css-version.mjs           report the expected version
 *   node scripts/css-version.mjs --write   rewrite every stylesheet reference
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// style.css itself carries the hash, so hashing it would be circular.
export const SOURCES = readdirSync(join(ROOT, 'css'))
  .filter(f => f.endsWith('.css') && f !== 'style.css')
  .sort()
  .map(f => `css/${f}`);

export function cssVersion() {
  const hash = createHash('sha256');
  for (const rel of SOURCES) hash.update(readFileSync(join(ROOT, rel)));
  return hash.digest('hex').slice(0, 8);
}

export function htmlFiles() {
  return readdirSync(ROOT).filter(f => f.endsWith('.html'));
}

// Matches every stylesheet href in a page, versioned or not, so a sheet that
// shipped without a ?v= is picked up rather than skipped.
const LINK_RE = /href="css\/([a-z-]+\.css)(?:\?v=[^"]*)?"/g;
const IMPORT_RE = /@import url\('\.\/([a-z-]+\.css)(?:\?v=[^']*)?'\)/g;
// file-focus.js injects its own stylesheet, so its href needs the same version.
const JS_INJECTED = 'js/file-focus.js';
const JS_HREF_RE = /(const CSS_HREF = '\/css\/[a-z-]+\.css)(?:\?v=[^']*)?'/;

function rewrite(relPath, pattern, replacer) {
  const path = join(ROOT, relPath);
  const src = readFileSync(path, 'utf8');
  const next = src.replace(pattern, replacer);
  if (next === src) return false;
  writeFileSync(path, next);
  return true;
}

function write(version) {
  rewrite('css/style.css', IMPORT_RE, (_m, file) => `@import url('./${file}?v=${version}')`);

  let pages = 0;
  for (const file of htmlFiles()) {
    if (rewrite(file, LINK_RE, (_m, name) => `href="css/${name}?v=${version}"`)) pages += 1;
  }

  const js = rewrite(JS_INJECTED, JS_HREF_RE, (_m, head) => `${head}?v=${version}'`);
  console.log(`css version ${version}: rewrote css/style.css, ${pages} page(s)${js ? `, ${JS_INJECTED}` : ''}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = cssVersion();
  if (process.argv.includes('--write')) write(version);
  else console.log(version);
}
