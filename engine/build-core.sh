#!/bin/sh
# Builds the duel engine ourselves: EDOPro's ygopro-core at its latest commit, compiled to WebAssembly
# with the ocgcore-wasm wrapper (https://github.com/n1xx1/ocgcore-wasm) plus our fixes (patches/).
# Output: engine/ocgcore/, a ready-to-install package that is committed, so servers never need Emscripten.
# Needs Emscripten (brew install emscripten). Rebuild when card scripts need a newer engine,
# then `npm run data` so engine and scripts match.
set -e
cd "$(dirname "$0")"
ENGINE="$PWD"
mkdir -p core-build && cd core-build
if [ -d src/.git ]; then git -C src checkout --quiet -- . && git -C src pull --quiet --ff-only
else git clone --quiet --depth 1 --recurse-submodules --shallow-submodules https://github.com/n1xx1/ocgcore-wasm.git src; fi
git -C src/cpp/ygo fetch --quiet --depth 1 origin master
git -C src/cpp/ygo checkout --quiet FETCH_HEAD
echo "engine: ygopro-core $(git -C src/cpp/ygo log -1 --format='%h %cs')"

# our fixes to the wrapper: decoders that don't match the current engine, plus mismatch detection
git -C src apply "$ENGINE"/patches/*.patch
# Emscripten 6 no longer accepts Module.wasmBinary unless asked to; Node needs it (the build otherwise tries to fetch() the file)
sed -i '' "s/-sMODULARIZE=1/-sMODULARIZE=1 -sINCOMING_MODULE_JS_API=['instantiateWasm','locateFile','onAbort','onRuntimeInitialized','postRun','preRun','print','printErr','wasmBinary']/" src/scripts/build.sh
# optimise for speed, not download size: this runs on our server, not in a browser
sed -i '' 's/-Os -g0/-O3 -g0/' src/scripts/build.sh
(cd src && chmod +x scripts/build.sh && ./scripts/build.sh 2>/dev/null)

# the wrapper's JS build only needs esbuild (its other dev tools pull in native packages we don't need)
[ -d tools/node_modules/esbuild ] || (mkdir -p tools && cd tools && npm init -y >/dev/null && npm install --silent --ignore-scripts esbuild@0.28)
(cd src && rm -rf node_modules && ln -s ../tools/node_modules node_modules && mkdir -p dist && rm -f dist/*.js dist/*.js.map && node scripts/build-lib.js >/dev/null)

# package it: the JS build already embeds the engine binary; the async (JSPI) variant isn't used, so leave it out
rm -rf "$ENGINE/ocgcore" && mkdir -p "$ENGINE/ocgcore/dist"
for f in src/dist/*.js; do case "$f" in *ocgcore.jspi-*) ;; *) cp "$f" "$ENGINE/ocgcore/dist/" ;; esac; done
cp src/LICENSE.md "$ENGINE/ocgcore/LICENSE-wrapper.md"
cp src/cpp/ygo/LICENSE "$ENGINE/ocgcore/LICENSE-ygopro-core" 2>/dev/null || cp src/cpp/ygo/COPYING "$ENGINE/ocgcore/LICENSE-ygopro-core"
git -C src/cpp/ygo log -1 --format='%H %cs' > "$ENGINE/ENGINE_COMMIT"
cat > "$ENGINE/ocgcore/package.json" <<JSON
{
  "name": "ocgcore-wasm",
  "version": "0.1.4-ma.$(cut -c1-8 "$ENGINE/ENGINE_COMMIT")",
  "description": "EDOPro ygopro-core $(cut -c1-8 "$ENGINE/ENGINE_COMMIT") as WebAssembly, built by Millennium Arena's engine/build-core.sh",
  "type": "module",
  "main": "dist/index.js",
  "exports": { ".": "./dist/index.js" },
  "license": "AGPL-3.0-or-later"
}
JSON
echo "built engine/ocgcore (engine $(cut -c1-8 "$ENGINE/ENGINE_COMMIT"))"
