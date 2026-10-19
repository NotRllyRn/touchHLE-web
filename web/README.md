# Browser runtime experiments

These are executable feasibility tests, not a browser port of the complete HLE.
The initial candidate CPU is pinned to `@alexaltea/unicorn-js` 2.1.4. Its ARM-only
bundle contains WebAssembly and runs locally in a disposable worker.

```
cd web
npm ci --ignore-scripts
npm test
npm run build
python3 -m http.server 8765 --bind 127.0.0.1 --directory dist
```

Open http://127.0.0.1:8765 and choose **Test browser CPU**. This HTTP server only
serves files. It does not emulate anything. Stop terminates the worker and its
memory; each test run starts a fresh instance. No CDN or remote API is required.

The same nine fixtures run in Node and in the browser: ARM, Thumb, interworking,
VFP, high-address memory with a write hook, SVC/resume, register contexts, unmapped
memory rejection, and bounded execution. These are smoke tests, not exhaustive
ISA validation or a game performance benchmark.

## Distribution boundary

The Unicorn dependency is GPL-2.0; see its package LICENSE (also copied into
local dist/vendor). Its source/build instructions are at
https://github.com/AlexAltea/unicorn.js and its Unicorn submodule. The lockfile
pins package integrity. Before publishing compiled artifacts, pin and provide
the exact corresponding source and build scripts and satisfy dependency license
requirements; a link to a moving upstream branch is not a source distribution.
Generated dist is deliberately ignored and not published by CI.

Rust HLE integration, memory mapping, fibers, graphics, audio, IPA loading, and
saves remain separate acceptance gates in ../dev-docs/browser.md.
