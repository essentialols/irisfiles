// e2e static server sending vercel.json's headers (incl. CSP). Usage: node test/server.mjs [port]
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import handler from 'serve-handler';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number(process.argv[2] || process.env.IRIS_TEST_PORT || 3988);

const vercel = JSON.parse(readFileSync(resolve(ROOT, 'vercel.json'), 'utf8'));

// Vercel patterns: `(.*)` and `:name*` match the rest, `:name` one segment.
function sourceToRegExp(source) {
  const ANY = '\u0000any\u0000';
  const SEG = '\u0000seg\u0000';
  const pattern = source
    .replace(/\(\.\*\)/g, ANY)
    .replace(/:[A-Za-z0-9_]+\*/g, ANY)
    .replace(/:[A-Za-z0-9_]+/g, SEG)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .split(ANY).join('.*')
    .split(SEG).join('[^/]+');
  return new RegExp(`^${pattern}$`);
}

const rules = (vercel.headers || []).map(rule => ({
  match: sourceToRegExp(rule.source),
  headers: rule.headers,
}));

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  for (const rule of rules) {
    if (!rule.match.test(path)) continue;
    for (const { key, value } of rule.headers) res.setHeader(key, value);
  }
  handler(req, res, { public: ROOT, cleanUrls: vercel.cleanUrls !== false });
});

server.listen(PORT, () => console.log(`serving ${ROOT} with vercel.json headers on http://localhost:${PORT}`));
