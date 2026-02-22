#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "Copying heic-to IIFE build..."
cp node_modules/heic-to/dist/iife/heic-to.js wasm/heic/heic-to.iife.js

echo "Bundling fflate..."
npx esbuild node_modules/fflate/esm/browser.js \
  --bundle --format=iife --global-name=fflate \
  --minify --outfile=js/fflate.min.js

echo "Bundling gifenc..."
npx esbuild node_modules/gifenc/dist/gifenc.esm.js \
  --bundle --format=iife --global-name=gifenc \
  --minify --outfile=js/gifenc.min.js

echo "Build complete."
