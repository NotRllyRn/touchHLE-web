# Experimental browser runtime

The browser runtime loads IPAs with the actual Rust HLE and executes ARM code
in a local worker. TinkerBox HD 1.4.1 reaches textured Training 01, runs its simulation, and
advances to Lesson 2, where zooming, dragging a ball into place and pressing
Play reaches SUCCESS. Click/tap, wheel pinch zoom, and touch drag work. Loading
can take tens of minutes, rendering is slow, and full-game compatibility and
save persistence are not yet verified.
The full runtime requires WebGL2, OffscreenCanvas, and WebAssembly exception
handling; Chromium is the currently tested browser.
The initial candidate CPU is pinned to `@alexaltea/unicorn-js` 2.1.4. Its ARM-only
bundle contains WebAssembly and runs locally in a disposable worker.

```
cd web
npm ci --ignore-scripts
npm run build
npm test
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

Acceptance results and remaining graphics, audio, and save limitations are
recorded in ../dev-docs/browser.md.

## Local IPA validation

Install Rust and `rustup target add wasm32-unknown-unknown` first. The build
compiles the Rust validator and copies it into dist. Select a local IPA up to
256 MiB. A worker reads the File locally, checks ZIP/plist/Mach-O eligibility,
and returns metadata. It never uploads the file. Stop destroys the worker;
reimport starts a fresh WASM instance. This does not execute the app.

`npm test` requires `npm run build` first. It runs the CPU smoke fixtures and
real WASM ABI tests, including encrypted/malformed inputs, repeated allocation
and cleanup, memory growth, and sparse guest-memory boundary checks.

For browser integration checks, install Playwright separately (it is not a
runtime dependency), start the static server above, then run:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
TEST_IPA=/absolute/path/to/owned.ipa node test-browser.mjs
```

`TEST_IPA` is optional. The script checks worker CPU tests, memory checks,
malformed-file rejection, import/stop/reimport and same-origin GET-only traffic.
The current Linux headless harness uses `--no-sandbox`; do not expose it as a
service or use it to browse untrusted sites.

## Rust/C fiber feasibility

With Emscripten 4.0.23 activated and the Rust wasm32-unknown-emscripten target:

```sh
node build-fibers.mjs
node -e "require('./dist/fiber-checks.js')({print: console.log})"
TEST_FIBERS=1 PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node test-browser.mjs
```

The fixture links Rust and C in one WASM module. C enters Rust, Rust calls a C
host callback, and that callback reenters Rust, which yields twice to the main
fiber. It checks preserved heap values, destructor counts and 100 restarts.
Rust uses panic=abort: unwinding across C/fiber boundaries is not supported.
An abort must terminate the worker; it cannot safely resume guest execution.
The full browser HLE now uses the separate adapter in `src/web_coroutine.rs`;
this small fixture tests the underlying fiber mechanism independently.

The sparse-memory prototype in `src/browser/src/memory.rs` maps only explicitly
allocated regions, with stable aligned host storage. Cross-page slices work
inside a region. Slices spanning independent regions are rejected rather than
fabricated. It does not enforce guest page permissions or unmap regions. The
browser `Mem` adapter now uses this storage for its bounded
low arena, fixed-address dylibs, and high stack; native `Mem` remains unchanged.

## Source-built CPU sharing Rust guest memory

The optional experiment links the patched Unicorn TCI interpreter and Rust in
one Emscripten module. It maps Rust-owned regions with `uc_mem_map_ptr`, calls
Rust from a memory hook, and checks ARM/Thumb/VFP, FPSCR context save/restore,
SVC stop/resume, code-cache invalidation, unmapped faults and instruction budgets.
After SVC stops the interpreter, a Rust host callback yields to the scheduler,
calls nested ARM with saved/restored CPU context, yields again, and returns to
resume the original ARM caller. Ten fresh interpreter instances pass this path.
It does not load an application or call the actual HLE frameworks.

From the repository root, after activating Emscripten 4.0.23:

```sh
git clone --branch v2.1.4 --recurse-submodules https://github.com/AlexAltea/unicorn.js target/unicorn.js
git -C target/unicorn.js checkout fdfcc4fd5e7d4ceeebe6b4d65b19eea4aa655e5d
git -C target/unicorn.js submodule update --init --recursive
(cd target/unicorn.js && python3 build.py arm)
node web/patch-unicorn.mjs
node web/build-shared-cpu.mjs
node -e "require('./web/dist/shared-cpu-checks.js')({print: console.log}).catch(e=>{console.error(e.message);process.exitCode=1})"
TEST_SHARED_CPU=1 TEST_FIBERS=1 \
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
TEST_IPA=/absolute/path/to/owned.ipa node web/test-browser.mjs
```

Pinned Unicorn submodule: `8028ec436f2d9376525352dd38ed9ed6b9f6be10`.
The Unicorn.js build applies its checked-in TCI/helper patches to that source.
The build check pins the wrapper revision; do not substitute another library.
The local source tree retains upstream licenses and patch/build sources.
The earlier distribution boundary also applies to this combined binary; these
commands are local experiments, not permission to publish an incomplete source
bundle. `dist` and `target` remain ignored.

Observed runtime warnings: Emscripten does not implement `madvise` or `mprotect`.
The fixtures pass, but host page protections cannot be assumed. Guest mapping
permissions and all invalid accesses must be enforced by the interpreter and
memory adapter. These warnings are retained in browser test output.

## Run the actual HLE

Build the validator/page first with `npm ci --ignore-scripts` and `npm run build`
in `web`. Activate Emscripten 4.0.23 and install Rust's
`wasm32-unknown-emscripten` target. Build the pinned Unicorn source and apply
`patch-unicorn.mjs` as above, then from the repository root:

```sh
node web/build-runtime.mjs
python3 web/fixtures/make-hle-ipa.py
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node web/test-runtime.mjs
```

The runtime build automatically applies the pinned Emscripten 4.0.23 shader
patches using `web/patch-emscripten.mjs`. They fix texture COMBINE expressions
containing texture matrices and implement point attenuation/size limits.
They also complete the existing material-emission setter.
The build requires a writable SDK source directory. Multisampled point fading
is not implemented or verified.

The test requires the static server on port 8765. Open the page, select a local
IPA, wait for validation, and click **Run IPA**. Leave **Headless diagnostics**
unchecked for graphics. **Stop** destroys the worker; selecting Run again starts
fresh. The original test IPA exercises real ARM, dyld, zero-length memcpy, puts,
and exit; it is not a game or graphics test.

The HLE uses bounded guest memory (256 MiB low arena plus separately mapped high
segments), Unicorn TCI, Emscripten fibers, SDL and GLES1-on-GL2 with WebGL2.
OffscreenCanvas is required for graphical runs. Pointer events are forwarded to
SDL. A page AudioContext plays PCM scheduled by the worker; persistent saves
and full game interaction remain unverified.
`patch-unicorn.mjs` is idempotent and verifies both source revisions. Rerun it
after rerunning the upstream build script. The patches fix temporary exhaustion
in long ARM translation blocks and expose the existing instruction-budget
counter so the adapter does not need a duplicate hook. The shared CPU fixture
also exercises the production adapter's stepping and ARM/Thumb tick accounting.
The archive in `build-wasm-eh` and its consumers use WASM-native longjmp.
Normal CPU runs use bounded block budgets; ticks are abstract and a slice can
overshoot by one translated block. Debugger single stepping remains exact.

For graphics and audio regressions (static server running):

```sh
python3 web/fixtures/make-hle-ipa.py --graphics
TEST_GRAPHICS=1 PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node web/test-runtime.mjs
python3 web/fixtures/make-hle-ipa.py --present
TEST_PRESENT=1 PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node web/test-runtime.mjs
python3 web/fixtures/make-hle-ipa.py --present-buffers
TEST_PRESENT_BUFFERS=1 PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node web/test-runtime.mjs
python3 web/fixtures/make-hle-ipa.py --combine
TEST_COMBINE=1 PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node web/test-runtime.mjs
python3 web/fixtures/make-hle-ipa.py --points
TEST_POINTS=1 PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node web/test-runtime.mjs
python3 web/fixtures/make-hle-ipa.py --point-parameters
TEST_POINT_PARAMETERS=1 PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node web/test-runtime.mjs
python3 web/fixtures/make-hle-ipa.py --lighting
TEST_LIGHTING=1 PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node web/test-runtime.mjs
python3 web/fixtures/make-hle-ipa.py --fog
TEST_FOG=1 PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node web/test-runtime.mjs
python3 web/fixtures/make-hle-ipa.py --mapped
TEST_MAPPED=1 PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node web/test-runtime.mjs
python3 web/fixtures/make-hle-ipa.py --light-attenuation
TEST_LIGHT_ATTENUATION=1 PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node web/test-runtime.mjs
python3 web/fixtures/make-hle-ipa.py --light-spot
TEST_LIGHT_SPOT=1 PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node web/test-runtime.mjs
python3 web/fixtures/make-hle-ipa.py --mipmap
TEST_MIPMAP=1 PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node web/test-runtime.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node web/test-audio.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node web/test-graphics-queries.mjs
```

For a longer graphical investigation, use `web/inspect-ipa.mjs` as documented
in `dev-docs/browser.md`; screenshots and control files stay in ignored target.
With a diagnostic runtime, `DIAGNOSTICS=1` logs draw counts and candidate saved
main-thread registers every 30 seconds. `INSPECTION_DIR` can select a separate
output directory (include its trailing slash) for each comparison run.

Both `inspect-ipa.mjs` and `test-runtime.mjs` accept `BROWSER_ARGS`, a JSON array
of extra Chromium arguments, and print it in the test log. For a separate
headless software-compositor comparison, use:

```sh
export BROWSER_ARGS='["--enable-gpu","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"]'
```

This still uses CPU-based SwiftShader, not a hardware GPU. Keep results from
this configuration separate from default launches and real-device measurements.
`unset BROWSER_ARGS` restores the default test configuration. This setting only
affects the test harness; the deployed app does not change browser launch flags.

## Experimental CPU acceleration

The source-built runtime includes an opt-in TCI-to-WebAssembly compiler. Open
`?cpu=jit` to compile hot blocks locally in the worker. `&jitThreshold=1` forces
compilation for regression tests. The default remains the interpreter. This
prototype has not met real-time TinkerBox or sub-10-second startup targets.
Requirements, architecture, tests and progress: `../dev-docs/wasm-jit/`.

After rebuilding the patched Unicorn and shared CPU fixture:

```sh
node --test web/test/tci-jit.test.mjs
TEST_SHARED_CPU=1 TEST_JIT=1 TEST_FIBERS=1 \
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node web/test-browser.mjs
node web/bench-cpu.mjs
```

The last command needs the activated Emscripten SDK. It verifies and times
original ARM arithmetic loops and repeated host-call exits, with five trials
per backend. These synthetic results do not establish game FPS. For startup
sampling use `TEST_IPA=/absolute/path/to/owned.ipa node web/profile-runtime.mjs`;
its sampled run is deliberately separate from acceptance timing. Wait for the
runtime build to finish before testing or serving its JS/Wasm pair.


## Offline game packages (experimental)

The profile-assisted converter produces a static game page with no IPA chooser.
It emits Wasm before play, reusing the same ARM/Thumb semantics and Rust HLE.
Unseen blocks still use JIT. ARM-to-TCI decoding also remains in the browser
to produce the exact current block identity; the offline artifact currently
eliminates repeated TCI-to-Wasm generation for matching blocks. This is not yet
a full-app static ARM recompiler. Browsers
still compile the supplied Wasm to native code. Three-trial results show no clear scene-load improvement; see
[measurements](../dev-docs/wasm-jit/PERFORMANCE.md).

With a built runtime and local Playwright available:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node web/precompile-ipa.mjs /absolute/path/to/owned.ipa target/my-game --seconds 180
python3 -m http.server 8766 --bind 127.0.0.1 --directory target/my-game
```

The command runs a bounded local preparation session. `--clicks actions.json`
accepts the inspector's timed `{second,x,y}` actions to cover additional scenes;
`INSPECTION_PORT` and its printed control JSON support live local diagnostics.
Coverage depends on those actions. A prior captured trace can be reused with
`--capture target/capture.json` when the IPA and core runtime fingerprints match.
Trace format1 with portable ABI versions1–3 can be recompiled with current
portable ABI3 code generation; it retains
TCI immediates and runtime ABI metadata, not executable host pointers to reuse.
Output directories must be new; repo-local outputs must live below ignored target/.

Open the generated site and click Play. `?cpu=jit` runs the same packaged IPA
without the precompiled cache for comparisons. `?jitThreshold=1` is for small
regression fixtures. The package includes the original game archive and base64
Wasm modules in precompiled.json; it does not publish or upload anything.
`build-report.json` records artifact sizes and offline build time. Logs distinguish
AOT preparation time, precompiled block instances, misses and fallback compilation.
The player verifies manifest/archive identity and served IPA/runtime SHA-256
hashes before enabling Play; verification time is logged separately. Publish the
output as one immutable directory, or replace it atomically, to keep runtime files
consistent throughout a session.
Do not interpret successful packaging or synthetic fixtures as TinkerBox acceptance.

Tests: `node --test web/test/tci-precompile.test.mjs web/test/tci-jit.test.mjs`.
`web/test-precompiled.mjs` checks two fresh runs of a generated original test IPA,
actual offline-module execution, clean guest exit, static GET-only traffic and
rejection of altered IPA/runtime/compiler/archive files before Play.
`node web/test-precompile-cli.mjs FIXTURE.ipa CAPTURE.json` checks producer
rejection of mismatched IPA/core fingerprints and an existing output directory.

For complete CPU/fiber regression coverage, build the shared CPU fixture first
(`node web/build-shared-cpu.mjs` with the SDK activated), then run
`node web/test-precompiled-cpu.mjs`. This injects the current compiler before guest
execution and compares capture versus offline modules through the real adapter.
The converter's `--threshold 1` option forces compilation for short test IPAs;
the ordinary game default remains32. Full static discovery is still pending.

To reproduce the isolated full-payload decode/checksum comparison, serve a generated
game directory and run `TEST_URL=http://127.0.0.1:8766/my-game/
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node web/bench-precompiled.mjs`.
Keep game performance trials and this benchmark separate.

Detailed diagnostics use the ordinary JIT uploader and separate timing/count runs:

```sh
PROFILE_MODE=timing PROFILE_PHASE=startup PROFILE_DELAY_MS=20000 PROFILE_MS=15000 \
  PROFILE_DIR=target/profile-startup TEST_IPA=/absolute/path/to/owned.ipa \
  PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node web/profile-runtime.mjs
```

Use `PROFILE_MODE=counts` for dynamic TCI opcode and immediate-helper call-site
visits. This adds substantial overhead; never use its elapsed time as acceptance
data. Timing mode adds unique Wasm function names without counters. Neither mode
times individual ARM instructions. Block visits include compiled self loops;
call-site visits include inline fast paths, not just actual helper calls. Metadata
retention is bounded and reports explicitly mark incomplete coverage. Raw Chrome
samples, counts, sampled self/inclusive time, logs and a screenshot stay local.
Counter windows include CDP command delays outside the sampling window; their
counts cannot be divided into sampled time to infer instruction latency.

`TCI_PROFILE_MODE=timing|counts node web/inspect-ipa.mjs` installs diagnostics
before game startup. Attach `web/profile-runtime.mjs` later with `PROFILE_CDP`
and the matching mode to inspect a selected scene. Use a browser with exactly
one page and one runtime worker; both must share the context and origin.
Snapshots and samples use the same CDP worker session, including reconnects.
Do not combine `TCI_PROFILE_MODE` and
`INSPECTION_OPTIONS` (both intercept worker loading). Cached-module profiling is
explicitly rejected: use the JIT reference until cached instrumentation exists.
Routed compiler hashes identify installed diagnostic sources; local runtime/IPA
fingerprints are references, not proof of remote or already-loaded worker bytes.

`SCREENSHOT_SECONDS=1` gives the inspector finer scene-transition observations
(default 10, allowed 1–60). The loop still samples at roughly one-second intervals;
screenshots and browser scheduling add overhead. Keep cadence identical between
compared runs and report the observation bounds, not exact engine event times.

Counts mode also exports cumulative translation-registration contexts keyed by
PC, flags and guest byte span. Repeated contexts do not prove identical code or
safe restoration: full translation flags and byte validation are separate work.
`registrationStats.omittedContexts` marks bounded-table overflow. Snapshots travel
as JSON strings to avoid excessive browser-protocol serialization overhead.
