// Vercel function: https://<deployment>/mcp (rewritten here by vercel.json).
// Stateless and file-free: it serves the tool list and the converter HTML.
import { handler } from '../server.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version',
};

async function handle(request) {
  const response = await handler.fetch(request);
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// Browser-based MCP clients (e.g. the MCP Inspector) preflight; chat hosts call server-to-server.
export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });
export { handle as GET, handle as POST, handle as DELETE };
