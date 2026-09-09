/**
 * Keep the stylesheet cache-buster tied to the stylesheet's actual contents.
 *
 * css/style.css is only an @import shim, so editing style-base.css or
 * theme-overhaul.css changes what a page renders without changing any URL a
 * browser has cached. That already shipped once: the redesign was live but
 * invisible to every returning visitor for four hours.
 *
 *   node scripts/css-version.mjs           report the expected version
 *   node scripts/css-version.mjs --write   rewrite style.css and every page
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// style.css itself carries the hash, so hashing it would be circular.
export const SOURCES = ['css/style-base.css', 'css/theme-overhaul.css'];

export function cssVersion() {
  const hash = createHash('sha256');
  for (const rel of SOURCES) hash.update(readFileSync(join(ROOT, rel)));
  return hash.digest('hex').slice(0, 8);
}

export function htmlFiles() {
  return readdirSync(ROOT).filter(f => f.endsWith('.html'));
}

const LINK_RE = /href="css\/style\.css\?v=[^"]*"/g;
const IMPORT_RE = /@import url\('\.\/([a-z-]+\.css)\?v=[^']*'\)/g;

function write(version) {
  const shimPath = join(ROOT, 'css/style.css');
  const shim = readFileSync(shimPath, 'utf8')
    .replace(IMPORT_RE, (_m, file) => `@import url('./${file}?v=${version}')`);
  writeFileSync(shimPath, shim);

  let pages = 0;
  for (const file of htmlFiles()) {
    const path = join(ROOT, file);
    const src = readFileSync(path, 'utf8');
    const next = src.replace(LINK_RE, `href="css/style.css?v=${version}"`);
    if (next !== src) {
      writeFileSync(path, next);
      pages += 1;
    }
  }
  console.log(`css version ${version}: rewrote css/style.css and ${pages} page(s)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = cssVersion();
  if (process.argv.includes('--write')) write(version);
  else console.log(version);
}
