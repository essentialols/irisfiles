# Third-party components

IrisFiles itself is MIT licensed (see [LICENSE](LICENSE)). The following third-party code and data is committed to this repository. Libraries that are loaded at runtime from a CDN (FFmpeg.wasm, pdf-lib, jsPDF, PDF.js, Tesseract.js, ExifReader, piexifjs, lamejs, ONNX Runtime Web and the background-removal models) are not redistributed here and keep their own licenses.

## Bundled in `js/` and `wasm/`

| Component | Location | License | Source |
| --- | --- | --- | --- |
| fflate | `js/fflate.min.js` (built from the npm package by `build.sh`) | MIT | https://github.com/101arrowz/fflate |
| gifenc | `js/gifenc.min.js` (built from the npm package by `build.sh`) | MIT | https://github.com/mattdesl/gifenc |
| heic-to (wraps libheif) | `wasm/heic/heic-to.csp.js` (the package's CSP-safe build) | LGPL-3.0 | https://github.com/hoppergee/heic-to |

The heic-to build is kept as a separate file so it can be replaced with another build of the same library.

## Test fixtures

`test/fixtures/` contains sample files for the test suite. The font fixtures are third-party fonts:

| Fixture | Font | License |
| --- | --- | --- |
| `sample.ttf`, `sample.woff` | DejaVu Sans | Bitstream Vera / DejaVu font license (free to use and redistribute) |
| `sample.otf` | Source Serif 4 | SIL Open Font License 1.1 |
