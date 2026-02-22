# ConvertFast

Privacy-first client-side image converter. See ARCHITECTURE.md for full details.

## Quick Reference
- **Build**: `bash build.sh` (copies WASM + bundles fflate from node_modules)
- **Dev server**: `npx serve . -p 3000`
- **No tests yet**: Manual testing with real image files
- **Deploy**: Push to GitHub main, auto-deploy on Vercel

## Key Files
- `js/converter.js` - Core image conversion (format detection, Canvas encode, HEIC lazy-load, ZIP)
- `js/ui.js` - Image converter DOM (drag-drop, file queue, progress, FAQ)
- `js/heic-worker.js` - Lazy HEIC WASM loader (main thread, not a Worker despite name)
- `js/pdf-engine.js` - PDF operations (image-to-PDF, PDF-to-image, merge) via pdf-lib/jsPDF/PDF.js
- `js/pdf-ui.js` - PDF page DOM controller (4 modes: img-to-pdf, pdf-to-img, merge, split)
- `js/boot.js` - Image converter page bootstrapper
- `js/pdf-boot.js` - PDF page bootstrapper
- `wasm/heic/heic-to.iife.js` - Pre-built HEIC decoder (~2.5MB, committed, also on jsDelivr CDN)
- `js/fflate.min.js` - Pre-built ZIP library (~32KB, committed)

## Conventions
- Each converter page: separate HTML with unique SEO meta, shared JS via ES module imports
- Format detection uses magic bytes, not file extensions
- HEIC is the only format needing WASM; everything else uses native Canvas API
- Heavy libraries (heic-to, pdf-lib, jsPDF, PDF.js) loaded from jsDelivr CDN with local fallback
- Safeguards: 100MB file limit, 100MP pixel limit, 50-file batch cap, 50MB PDF merge limit
