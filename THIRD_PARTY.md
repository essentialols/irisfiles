# Third-party components

IrisFiles itself is MIT licensed (see [LICENSE](LICENSE)). The following third-party code and data is committed to this repository. Libraries that are loaded at runtime from a CDN (FFmpeg.wasm, pdf-lib, jsPDF, PDF.js, Tesseract.js, ExifReader, piexifjs, lamejs, ONNX Runtime Web and the background-removal models) are not redistributed here and keep their own licenses.

## Bundled in `js/` and `wasm/`

| Component | Location | License | Source |
| --- | --- | --- | --- |
| fflate | `js/fflate.min.js` (built from the npm package by `build.sh`) | MIT | https://github.com/101arrowz/fflate |
| gifenc | `js/gifenc.min.js` (built from the npm package by `build.sh`) | MIT | https://github.com/mattdesl/gifenc |
| heic-to 1.4.2 (contains libheif and libde265, see below) | `wasm/heic/heic-to.csp.js` (the package's CSP-safe build) | LGPL-3.0-or-later | https://github.com/hoppergee/heic-to |

## HEIC decoder (LGPL)

HEIC decoding uses these libraries, compiled with Emscripten. Each is licensed under the GNU Lesser General Public License version 3 ([licenses/LGPL-3.0.txt](licenses/LGPL-3.0.txt)), which builds on the GNU General Public License version 3 ([licenses/GPL-3.0.txt](licenses/GPL-3.0.txt)).

| Library | Version | Source code |
| --- | --- | --- |
| heic-to | 1.4.2 | https://github.com/hoppergee/heic-to/tree/v1.4.2, also https://registry.npmjs.org/heic-to/-/heic-to-1.4.2.tgz |
| libheif | 1.21.2 | https://github.com/strukturag/libheif/releases/tag/v1.21.2 |
| libde265 | 1.0.15 | https://github.com/strukturag/libde265/releases/tag/v1.0.15 |

No other codecs are compiled into this build. The libraries are used unmodified. heic-to's README ("How to build libheif.js") gives the build steps; it runs libheif's `build-emscripten.sh`, which downloads and compiles the libde265 release above (its default pin).

**Replacing the library.** IrisFiles' own code is MIT licensed and published in this repository, so you can combine it with a modified or different build of these libraries:

- **irisfiles.com** loads the decoder as one separate file: heic-to 1.4.2 from jsDelivr, falling back to `wasm/heic/heic-to.csp.js` (`js/heic-worker.js`). To use your own build of heic-to's `dist/csp/heic-to.js`, point `CDN_URL` in `js/heic-worker.js` at it, or replace the local file (or install it into `node_modules/heic-to` and run `bash build.sh`) and drop the CDN import.
- **The MCP App** (`mcp-app/`) inlines the decoder into its single HTML file. Install your build into `mcp-app/node_modules/heic-to` (for example `npm install /path/to/your/heic-to`) and run `npm run build` in `mcp-app/`; the output is `mcp-app/dist/irisfiles-app.html`.

The MCP App also inlines permissively licensed libraries (fflate, pdf-lib, `@modelcontextprotocol/ext-apps` and their dependencies); their license comments are kept at the end of its bundled script.

## Test fixtures

`test/fixtures/` contains sample files for the test suite. The font fixtures are third-party fonts:

| Fixture | Font | License |
| --- | --- | --- |
| `sample.ttf`, `sample.woff` | DejaVu Sans | Bitstream Vera / DejaVu font license (free to use and redistribute) |
| `sample.otf` | Source Serif 4 | SIL Open Font License 1.1 |
