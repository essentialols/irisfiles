// Bundle the view into one self-contained HTML file (the MCP App resource).
// Everything is inlined so the default, restrictive host CSP is enough: no
// resourceDomains or connectDomains are needed.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const here = new URL('.', import.meta.url);
const result = await build({
  entryPoints: [new URL('src/app.js', here).pathname],
  bundle: true,
  format: 'esm',
  minify: true,
  write: false,
  target: 'es2022',
  legalComments: 'none',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const template = await readFile(new URL('src/app.html', here), 'utf8');
const html = template.replace('/*__APP_JS__*/', () => js);
await mkdir(new URL('dist/', here), { recursive: true });
await writeFile(new URL('dist/irisfiles-app.html', here), html);
console.log(`dist/irisfiles-app.html ${(html.length / 1024).toFixed(0)} KB`);
