// Talks to the server as an MCP host would: list tools, call the tool, read
// the UI resource. Checks the MCP Apps contract (ui:// URI, mime type, link).
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startHttp } from '../server.mjs';

const http = await startHttp(0);
const url = new URL(`http://127.0.0.1:${http.address().port}/mcp`);
const client = new Client({ name: 'contract-test', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(url));

const { tools } = await client.listTools();
const tool = tools.find(t => t.name === 'open_converter');
assert.ok(tool, 'open_converter is listed');
assert.equal(tool._meta?.ui?.resourceUri, 'ui://irisfiles/converter.html');
assert.deepEqual(Object.keys(tool.inputSchema.properties), ['target'], 'the only input is the output target: no file contents');

const result = await client.callTool({ name: 'open_converter', arguments: { target: 'jpg' } });
assert.match(result.content[0].text, /not shared with you/);

const resource = await client.readResource({ uri: tool._meta.ui.resourceUri });
const [content] = resource.contents;
assert.equal(content.mimeType, 'text/html;profile=mcp-app');
assert.deepEqual(content._meta?.ui?.csp, { connectDomains: [], resourceDomains: [] }, 'restrictive CSP: no network, no external resources');
assert.match(content.text, /^<!DOCTYPE html>/);
assert.ok(!/<script[^>]+src=/i.test(content.text), 'no external scripts: works under the default CSP');

await client.close();
http.close();
console.log(`server contract OK (resource ${(content.text.length / 1024).toFixed(0)} KB)`);
