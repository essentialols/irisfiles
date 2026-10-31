// Minimal MCP Apps host for the spike: the same double-iframe layout and
// AppBridge wiring as the reference host (ext-apps/examples/basic-host),
// without the React shell. Records what the view sends to the host.
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') || 'loose';
const withDownload = params.get('download') !== '0';
const sandboxOrigin = params.get('sandbox');

window.__host = { downloads: [], modelContext: [], messages: [], ready: false };

const html = await (await fetch('/app.html')).text();
const iframe = document.createElement('iframe');
iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
iframe.style.cssText = 'width:100%;height:640px;border:1px solid #ccc';
document.body.appendChild(iframe);

const proxyReady = new Promise(resolve => {
  window.addEventListener('message', function onMsg(e) {
    if (e.source === iframe.contentWindow && e.data?.method === 'ui/notifications/sandbox-proxy-ready') {
      window.removeEventListener('message', onMsg);
      resolve();
    }
  });
});
iframe.src = `${sandboxOrigin}/sandbox.html?mode=${mode}`;
await proxyReady;

const capabilities = { openLinks: {}, updateModelContext: { text: {} }, logging: {} };
if (withDownload) capabilities.downloadFile = {};
const bridge = new AppBridge(null, { name: 'spike-host', version: '1.0.0' }, capabilities);
bridge.ondownloadfile = async ({ contents }) => {
  window.__host.downloads.push(contents.map(c => ({
    uri: c.resource?.uri, mimeType: c.resource?.mimeType, size: (c.resource?.blob || '').length, head: (c.resource?.blob || '').slice(0, 16),
  })));
  return {};
};
bridge.onupdatemodelcontext = async params => { window.__host.modelContext.push(params); return {}; };
bridge.onmessage = async params => { window.__host.messages.push(params); return {}; };
const initialized = new Promise(resolve => { bridge.oninitialized = resolve; });
await bridge.connect(new PostMessageTransport(iframe.contentWindow, iframe.contentWindow));
await bridge.sendSandboxResourceReady({ html });
await initialized;
window.__host.ready = true;
