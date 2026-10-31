# IrisFiles MCP App (prototype)

IrisFiles inside Claude, ChatGPT and other MCP Apps hosts. A tool, `open_converter`, shows the converter in the chat. The person drops files into it, and they are converted **in the host's sandboxed iframe on their device**. The model only gets a one-line summary (names and sizes). The server only ever serves static HTML and never receives a file.

```
user: "convert my iPhone photos to JPG"
  └─▶ model calls open_converter {target: "jpg"}
        └─▶ host renders ui://irisfiles/converter.html in a sandboxed iframe
              ├─ person drops files ─▶ converted in the iframe (canvas / pdf-lib / fflate / libheif)
              ├─ "Save" ─▶ ui/download-file ─▶ host saves the file
              └─ updateModelContext: "converted 2 files: a.jpg (120 KB)…"  (no contents)
```

## Run

```bash
npm install
npm run build        # bundles src/ into one self-contained dist/irisfiles-app.html
npm start            # MCP server on http://localhost:3001/mcp
npm test             # server contract + sandbox runtime spike
```

To try it in Claude or ChatGPT, deploy `server.mjs` to a public HTTPS URL and add it as a custom connector.

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
- **Size.** Inlining libheif makes the resource about 3.7 MB. If a host limits resource size, load heic-to from `cdn.jsdelivr.net` via `_meta.ui.csp.resourceDomains` instead.
