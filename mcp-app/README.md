# IrisFiles MCP App (prototype)

IrisFiles inside Claude, ChatGPT and other MCP Apps hosts. A tool, `open_converter`, shows the converter in the chat. The person drops files into it, and they are converted **in the host's sandboxed iframe on their device**. After a conversion the model gets a one-line summary: the number of files, the output format and the total input and output sizes. It never gets file names or contents. The server only ever serves static HTML and never receives a file.

```
user: "convert my iPhone photos to JPG"
  └─▶ model calls open_converter {target: "jpg"}
        └─▶ host renders ui://irisfiles/converter.html in a sandboxed iframe
              ├─ person drops files ─▶ converted in the iframe (canvas / pdf-lib / fflate / libheif)
              ├─ "Save" ─▶ ui/download-file ─▶ host saves the file
              └─ updateModelContext: "converted 2 file(s) to JPG: 2 output file(s), input 3 MB, output 1 MB"  (no names, no contents)
```

## Run

```bash
npm install           # tests also need a Playwright Chromium: npx playwright install chromium
npm run build        # bundles src/ into one self-contained dist/irisfiles-app.html
npm start            # MCP server on http://127.0.0.1:3001/mcp (PORT, HOST to override)
npm test             # server contract, Vercel function, sandbox runtime spike
```

The tool's optional `target` argument preselects the output format in the view (via the host's tool-input notification).

## Deploy (its own Vercel project, separate from irisfiles.com)

`api/mcp.js` serves the same server as a stateless Vercel function at `/mcp`. It is a separate project, so the static site stays serverless and keeps its "there is no server" promise. The repository-root `.vercelignore` keeps `mcp-app/` out of the site's deploys, and `mcp-app/.vercelignore` takes precedence inside this project.

- **CLI (any branch):** `cd mcp-app && npx vercel@latest --prod`. Log in when asked and accept the defaults.
- **Dashboard:** New Project → import `essentialols/irisfiles` → **Root Directory: `mcp-app`** → Deploy. The production branch must contain `mcp-app/` with `api/` (main, once this is merged).

Use the **production** URL. Vercel's Deployment Protection puts preview URLs behind a login by default, and a connector would get a 401. Opening the deployment's root shows the exact connector URL (`https://<deployment>/mcp`).

To host it elsewhere, run `server.mjs` with `HOST=0.0.0.0` behind your own TLS proxy. The default binds to loopback only.

Checked before shipping: `vercel build` (CLI 65.9.0) succeeds offline, and `FUNCTION_MODULE=<build output>/api/mcp.js node test/vercel-function.mjs` passes against the built function. The inlined resource is 3.7 MB of Vercel's 4.5 MB response limit.

## Connect it

| Host | Where | Notes |
|---|---|---|
| Claude (Free/Pro/Max/Ultra) | **Customize → Connectors → Add custom connector**, paste the `/mcp` URL, Authentication **No sign-in** | Free plans allow one custom connector |
| Claude (Team/Enterprise) | An Owner adds it under **Organization settings → Connectors → Add → Custom** | Members then click **Connect** |
| ChatGPT | **Settings → Apps & Connectors → Advanced settings → Developer Mode**, then **Create**, paste the URL, **Scan Tools** | Full apps need Business/Enterprise/Edu |

Then ask *"convert my HEIC photos to JPG"*. If the host blocks WebAssembly, HEIC shows a clear message and JPG/PNG/WebP, PDF merge and ZIP still work. That message answers the open WebAssembly question for that host.

## Known gaps before deploying

- **File-size limits (addressed).** The view takes at most 100 MB per file (the same as irisfiles.com) and 200 MB per batch. Larger files are skipped with a reason and a pointer to irisfiles.com. A host can still cap `ui/download-file` lower; a declined save shows as such.
- **LGPL inlining.** The bundle inlines libheif (via `heic-to`), which is LGPL. Inlining it into one HTML file needs a license review and the notices/relinking terms the LGPL requires; the main site's third-party notices do not cover this bundle.

## Spike results (2026-10-30)

`test/sandbox-runtime.mjs` runs the built view in a double-iframe host (the same layout as `ext-apps/examples/basic-host`) under two Content Security Policies:

| Capability | Reference host CSP | Spec CSP (2026-01-26) |
|---|---|---|
| WebAssembly compiles | ✅ | ❌ no `wasm-unsafe-eval`, and the spec has no way to declare it |
| `blob:` Web Worker (FFmpeg.wasm) | ✅ | ❌ no `worker-src`, so it falls back to `script-src` |
| PNG/JPG/WebP via canvas | ✅ | ✅ |
| HEIC → JPG (libheif WebAssembly) | ✅ | ❌ fails fast and points to irisfiles.com |
| Merge PDF (pdf-lib) | ✅ | ✅ |
| ZIP (fflate) | ✅ | ✅ |
| Save via `ui/download-file` | ✅ | ✅ |
| Direct `<a download>` from the iframe | ❌ blocked (no `allow-downloads`) | ❌ |
| File contents shared with the model | none | none |

What it means:

- **Pure-JavaScript tools work in every compliant host.** That covers canvas image conversion, PDF merge/split, ZIP, and likely fonts and documents.
- **WebAssembly tools depend on the host.** HEIC, AVIF fallback, video/audio (FFmpeg), OCR and background removal all use WebAssembly. A strict reading of the spec blocks them. A spec proposal to let apps declare WebAssembly is open (ext-apps issue #605). One public report says ChatGPT's iframe allows WebAssembly and blob workers. Claude's policy is undocumented and has to be tested with a deployed connector.
- **Saving results needs `ui/download-file`.** It is in the draft spec, not the 2026-01-26 stable one. Without it the view says "Saving not supported here" rather than failing silently. The host may also cap download size.
- **Size.** Inlining libheif makes the resource about 3.7 MB, which fits Vercel's 4.5 MB response limit. If a host limits resource size, or the LGPL review prefers libheif as a separate file, it could be served from the deployment's own origin and declared in `_meta.ui.csp.resourceDomains`. That trades the current no-network CSP for a smaller, separately loaded library.
