# IrisFiles

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Privacy-first file converter that runs entirely in the browser. No uploads, no servers, no tracking. Files never leave the user's device.

**Live:** [irisfiles.com](https://irisfiles.com)

## The idea

In March 2025, the FBI warned about malicious online file converters distributing malware. The core problem: most converters upload your files to a remote server. You have no way to know what happens to them after they leave your device.

IrisFiles solves this by doing everything client-side. The entire app is static HTML, CSS, and vanilla JavaScript. There is no backend. Conversions run in the browser using the Canvas API and WebAssembly. The result downloads directly to the user's device.

This makes it:
- **Private by architecture**, not just by policy. There is no server that could be compromised, subpoenaed, or breached.
- **Free to operate.** Near-zero hosting costs (static files on Vercel free tier). No compute, no storage, no bandwidth costs from file processing.
- **Fast.** No upload/download round-trip. Most conversions complete in milliseconds.

## Features

150 tool pages, grouped on the landing page into the categories below (153 HTML pages in total,
counting `index.html`, `about.html` and `privacy.html`):

| Category | Tools |
|----------|-------|
| **Images** | HEIC, WebP, PNG, JPG, SVG, BMP, GIF, AVIF, TIFF, ICO (cross-convert to JPG/PNG/WebP/PDF), plus PNG-to-ICO |
| **Image Tools** | Compress (quality slider), Resize, Strip EXIF (batch), Metadata Viewer/Editor (lossless JPEG), Images-to-GIF, Image-to-Text OCR |
| **Video** | MOV/AVI/MKV/WebM/MP4 cross-convert, Video-to-GIF, Compress, Speed, Metadata |
| **Video → Audio** | MP4/MOV/WebM/AVI/MKV to MP3 or WAV, with browser decoding first and FFmpeg.wasm fallback |
| **Audio** | MP3, WAV, OGG, FLAC, M4A, AAC cross-convert, Compress |
| **PDF** | PDF-to-Image, Merge, Split, OCR, Compress, Rotate, Delete Pages, Extract Pages, Reorder Pages, PDF-to-Text |
| **Documents** | EPUB/RTF/DOCX/MOBI to TXT and PDF; self-contained HTML to PDF with scripts and remote resources blocked |
| **Fonts** | TTF, OTF, WOFF cross-convert |
| **Archives** | ZIP extract and create |

Most conversion tools include batch processing (up to 50 files), ZIP download, and drag-and-drop. The landing page auto-detects common file types, suggests relevant tools, and hands dropped files to the selected converter without uploading them.

## Usage

```bash
# Install dev dependencies (serve, for local preview)
npm install

# Start local dev server
npx serve . -p 3000

# Run validation suite (153 pages, SEO meta, JSON-LD, internal links, sitemap)
npm test

# Run the Playwright end-to-end suite (spins up a server on :3988)
npm run test:e2e

# Build (only needed if updating WASM or fflate)
bash build.sh

# Deploy (auto-deploys on push to main via Vercel)
git push origin main
```

No build step required for day-to-day development. Edit HTML/JS/CSS and refresh.

## Technology

- **Image encoding:** Browser Canvas API (`toBlob`)
- **HEIC decoding:** [heic-to](https://github.com/nicolo-ribaudo/heic-to) (WebAssembly, libheif 1.21.2, lazy-loaded ~2.5MB)
- **Video:** FFmpeg.wasm (lazy-loaded from jsDelivr CDN)
- **Video-to-audio:** Web Audio API + lamejs/WAV fast path, FFmpeg.wasm fallback
- **Audio:** lamejs for MP3 encoding, Web Audio API for decoding
- **PDF:** pdf-lib, jsPDF, PDF.js (all lazy-loaded from CDN)
- **OCR:** Tesseract.js with lazy-loaded language models
- **HTML-to-PDF:** sanitized sandboxed HTML rendered with html2canvas + jsPDF; scripts and remote resources blocked
- **ICO writing:** Browser-generated multi-resolution PNG payloads packed directly into an ICO container
- **Metadata:** ExifReader (read all formats) + piexifjs (lossless JPEG write)
- **ZIP:** fflate (~8KB gzipped)
- **Format detection:** Magic bytes, not file extensions
- **Framework:** None. Pure HTML + CSS + vanilla JS modules
- **Hosting:** Vercel free tier, static files only

## Support

IrisFiles is free with no limits, no accounts, and no ads. If you find it useful, you can support development via:

- [Ko-fi](https://ko-fi.com/irisfiles)

### Principles
- No ads. No tracking. No data collection. The privacy-first positioning is the product's primary differentiator and should never be compromised for revenue.
- Any monetization should be obvious and non-intrusive. No dark patterns, no artificial limits on free features.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed technical architecture: module structure, conversion pipeline, JS patterns, CDN loading strategy, and per-tool documentation.

## Project structure

Everything at the repo root is published: `vercel.json` sets `"outputDirectory": "."`, so a page's
filename *is* its URL. Root HTML files cannot be moved into subdirectories without changing live
URLs and breaking `sitemap.xml`.

```
irisfiles/
  index.html              # Landing page with smart drop + tool matrix
  about.html, privacy.html
  *.html                  # 150 tool pages (one per tool), 132 of them <from>-to-<to>
  css/style.css           # Main stylesheet shim (versioned imported sheets)
  css/high-value-tools.css # Additional UI for PDF/high-value tool pages
  js/                     # ~78 modules, flat, grouped by filename stem
    converter.js          # Core: format detection, Canvas encode, download, ZIP
    ui.js                 # Image converter UI (drag-drop, queue, progress)
    heic-worker.js        # Lazy HEIC WASM loader
    smart-drop.js         # Landing page: magic byte detection, IndexedDB routing
    high-value-landing.js # Adds new tool rows + smart-drop destination handoff
    ffmpeg-shared.js      # Shared FFmpeg.wasm loader for video/audio tools
    media-audio-engine.js # Video-to-MP3/WAV fast path + FFmpeg fallback
    image-ocr-engine.js   # Image-to-text OCR preprocessing + Tesseract
    ico-engine.js         # Multi-resolution ICO writer
    pdf-tools-engine.js   # PDF page edits/text/compression
    html-pdf-engine.js    # Sanitized local HTML-to-PDF rendering
    device-tier.js, meta-panel.js, notice-ui.js, ux-page.js, cities-geo.js
    <tool>-engine.js      # Pure conversion logic where practical
    <tool>-ui.js          # DOM controllers
    <tool>-boot.js        # Per-page bootstrappers (usually 2 lines)
    fflate.min.js         # ZIP library (committed, third-party)
    gifenc.min.js         # GIF encoder (committed, third-party)
  wasm/heic/              # HEIC WASM binary (committed, ~2.5MB)
  data/file-signatures.json   # Magic-byte table, generated by scripts/build-file-sigs.js
  scripts/build-file-sigs.js  # Regenerates data/file-signatures.json
  img/                    # og-default.png (social card, linked from every page),
                          # favicon-source.png (source for favicon.png/.svg)
  test/validate.mjs       # Validation suite (153 pages, SEO/links/sitemap/CSP)
  test/e2e/               # Playwright specs, driven by playwright.config.mjs
  reddit/                 # One-off 2026-03 launch promotion, not part of the site
  patrol.sh, PATROL.md    # Automated Claude Code bug patrol; patrol.sh is invoked by
                          # .git/hooks/pre-push, so it must stay at the repo root
  build.sh                # One-shot: copy WASM + bundle fflate from node_modules
  vercel.json             # Clean URLs, CSP headers, WASM cache
  serve.json              # Clean URLs for the local `npx serve` dev server
  sitemap.xml             # 153 URLs
  robots.txt
```

Generated, gitignored, and safe to delete at any time: `test-results/` (Playwright), `.patrol/`
(patrol run state), `.project-state/`, `.serena/`, `.claude/`, `.vercel/`, `.codegraph.db*`.

## License

MIT
