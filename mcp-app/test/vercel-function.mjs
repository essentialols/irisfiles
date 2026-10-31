// Runs api/mcp.js the way Vercel invokes a web-standard function: the request
// arrives at /mcp, is rewritten to /api/mcp, and the exported method handler
// gets a Request. Then talks to it as an MCP host would.
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
// FUNCTION_MODULE points this at a `vercel build` output to test the bundle itself.
const fn = await import(process.env.FUNCTION_MODULE ? new URL(`file://${process.env.FUNCTION_MODULE}`).href : '../api/mcp.js');

const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
const rewrite = path => config.rewrites.find(r => r.source === path)?.destination ?? path;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (rewrite(url.pathname) !== '/api/mcp') { res.writeHead(404).end(); return; }
  const method = fn[req.method];
  if (!method) { res.writeHead(405).end(); return; }
  const body = ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Readable.toWeb(req);
  const request = new Request(url, { method: req.method, headers: req.headers, body, duplex: 'half' });
  const response = await method(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const preflight = await fetch(`${base}/mcp`, { method: 'OPTIONS' });
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get('access-control-allow-origin'), '*');

const client = new Client({ name: 'vercel-test', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
const { tools } = await client.listTools();
assert.deepEqual(tools.map(t => t.name), ['open_converter']);
const call = await client.callTool({ name: 'open_converter', arguments: { target: 'png' } });
assert.match(call.content[0].text, /output: png/);
const [resource] = (await client.readResource({ uri: tools[0]._meta.ui.resourceUri })).contents;
assert.equal(resource.mimeType, 'text/html;profile=mcp-app');
assert.deepEqual(resource._meta.ui.csp, { connectDomains: [], resourceDomains: [] }, 'same restrictive CSP as the local server');
const payload = JSON.stringify(resource).length;
assert.ok(payload < 4.5 * 1024 * 1024, `resource response ${payload} bytes must fit Vercel's 4.5MB response limit`);
await client.close();
server.close();
console.log(`vercel function OK (/mcp -> /api/mcp, resource response ${(payload / 1024).toFixed(0)} KB of 4608 KB allowed)`);
