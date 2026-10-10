#!/bin/sh
# Bundle the React UI into public/app.js (committed, so Vercel needs no build step).
# Uses esbuild + React from a local node_modules (NODE_PATH); run from the repo root.
set -e
ESBUILD=${ESBUILD:-esbuild}
NODE_PATH=${NODE_PATH:-/opt/npm-tools/node_modules} $ESBUILD web/src/main.jsx --bundle --minify --format=iife \
  --jsx=automatic --define:process.env.NODE_ENV='"production"' --target=es2020 --outfile=public/app.js --log-level=warning
echo "built public/app.js ($(wc -c < public/app.js) bytes)"
