/**
 * IrisFiles MCP App server.
 *
 * One tool, open_converter, that shows the IrisFiles converter inside the chat.
 * The server only ever serves static HTML: it never receives a file, and the
 * tool takes no file arguments, so file bytes cannot reach it or the model.
 *
 *   node server.mjs            Streamable HTTP on 127.0.0.1:3001/mcp (PORT and HOST to change;
 *                              set HOST=0.0.0.0 only behind the deploy's own TLS/proxy)
 */
import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';

const RESOURCE_URI = 'ui://irisfiles/converter.html';
const HTML_PATH = new URL('dist/irisfiles-app.html', import.meta.url);
// Read once per process: serverless instances serve many requests.
let htmlPromise;
const loadHtml = () => (htmlPromise ??= readFile(HTML_PATH, 'utf8'));

export function createServer() {
  const server = new McpServer({ name: 'IrisFiles', version: '0.1.0' });

  registerAppTool(server, 'open_converter', {
    title: 'Convert files privately',
    description:
      'Open the IrisFiles converter in the conversation so the user can convert images (HEIC, PNG, JPG, WebP), '
      + 'merge PDFs or create a ZIP. Conversion runs on the user\'s device: do not ask the user to attach the file '
      + 'to the chat; they drop it into the converter instead, and its contents are never sent to you.',
    inputSchema: z.object({
      target: z.enum(['jpg', 'png', 'webp', 'merge-pdf', 'zip']).optional()
        .describe('Preselected output, e.g. "jpg" for "convert my HEIC photos to JPG".'),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: RESOURCE_URI } },
  }, async ({ target }) => ({
    content: [{
      type: 'text',
      text: `Opened the IrisFiles converter${target ? ` (output: ${target})` : ''}. The user drops files into it; `
        + 'they are converted on their device and are not shared with you.',
    }],
    structuredContent: { target: target ?? null },
  }));

  registerAppResource(server, RESOURCE_URI, RESOURCE_URI, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{
      uri: RESOURCE_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: await loadHtml(),
      // Everything is inlined, so the restrictive default CSP is all we need.
      _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true } },
    }],
  }));

  return server;
}

/**
 * Web-standard handler (Request -> Response), stateless, for serverless
 * runtimes; api/mcp.js serves it on Vercel. It also answers older MCP clients.
 */
export const handler = createMcpHandler(() => createServer());

export async function startHttp(port = Number(process.env.PORT || 3001), host = process.env.HOST || '127.0.0.1') {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.all('/mcp', async (req, res) => {
    const server = createServer();
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  return new Promise(resolve => {
    const httpServer = app.listen(port, host, () => resolve(httpServer));
  });
}

// import.meta.url is the symlink-resolved path, so resolve argv[1] too (e.g. /tmp -> /private/tmp).
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const s = await startHttp();
  console.log(`IrisFiles MCP App server on http://${s.address().address}:${s.address().port}/mcp`);
}
